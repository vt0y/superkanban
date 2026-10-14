# วิธีตั้งค่าและ Deploy ระบบ AI Tarot

ระบบแบ่งเป็น 3 ส่วน:

1. Firebase Hosting/Auth/Firestore เดิมของ SuperKanban
2. Cloudflare Worker + D1 สำหรับสับไพ่ เก็บ session ชั่วคราว และซ่อน KKU API key
3. Backblaze B2 + Cloudflare CDN สำหรับภาพไพ่ 78 ใบ

ห้ามใส่ KKU API key ใน `.env` ของ Vite เพราะค่าที่ขึ้นต้นด้วย `VITE_` จะถูกส่งไปยัง browser

## 1. เตรียมภาพไพ่ 78 ใบ

วิธีแนะนำคือดาวน์โหลดชุด Pam-A ครบ 78 ใบจาก Wikimedia Commons โดยระบบจะตรวจ Public Domain, จำนวนไฟล์, MIME type และ checksum ให้:

```bash
npm run tarot:images:download
```

ระบบจะเก็บ URL ต้นทาง, license, ขนาดภาพ และ checksum ไว้ใน `tarot-assets/inbox/source-manifest.json`

หรือจะนำภาพ Rider–Waite ที่มีสิทธิ์ใช้งาน/public domain ครบ 78 ใบใส่เองใน:

```text
tarot-assets/inbox/
```

ไม่ต้องใส่ภาพหลังไพ่ เพราะหน้าเว็บสร้างหลังไพ่เองด้วย CSS และอย่า commit ภาพต้นฉบับเข้า Git

ตรวจว่าตัว parser จับคู่ได้ครบ:

```bash
npm run tarot:images:check
```

ถ้าชื่อไฟล์กำกวม ให้ดูชื่อมาตรฐานแล้ว rename ไฟล์ต้นฉบับ:

```bash
npm run tarot:images:list
```

เมื่อ check แสดง `78/78` และไม่มี Missing, Duplicate หรือ Unmatched ให้เตรียมชุด upload:

```bash
npm run tarot:images:prepare
```

ผลลัพธ์อยู่ที่:

```text
tarot-assets/upload/deck-v1/
```

ภายในจะมี WebP 78 ไฟล์, `manifest.json` พร้อม SHA-256 และ `upload-list.txt` ตัว parser ไม่แก้ไฟล์ใน `inbox/` และไม่เขียนทับ output เดิม ถ้าต้องการสร้างใหม่ให้ใช้:

```bash
npm run tarot:images:prepare -- --force
```

เครื่องต้องมี ImageMagick (`magick` หรือ `convert`) หรือ `cwebp` อย่างใดอย่างหนึ่ง

## 2. ตั้ง Backblaze B2

1. เข้า Backblaze → B2 Cloud Storage → Create a Bucket
2. ตั้ง bucket เป็น Public เพราะเป็นภาพไพ่สาธารณะ ห้ามใส่ข้อมูลผู้ใช้ใน bucket นี้
3. อัปโหลดโฟลเดอร์ `tarot-assets/upload/deck-v1/` โดยให้ path บน B2 เป็น `deck-v1/<filename>.webp`
4. เปิดรายละเอียดไฟล์ใดไฟล์หนึ่ง แล้วจด hostname ของ Friendly URL เช่น `f005.backblazeb2.com`
5. ทดสอบ origin โดย URL ต้องเปิดภาพได้ เช่น:

```text
https://f005.backblazeb2.com/file/<bucket-name>/deck-v1/major-00-fool.webp
```

## 3. วาง Cloudflare CDN หน้า B2

โดเมนหลักต้องอยู่บน Cloudflare ก่อน เช่นจะใช้ `cards.example.com`

1. Cloudflare → DNS → Add record
2. Type: `CNAME`
3. Name: `cards`
4. Target: hostname ของ B2 เช่น `f005.backblazeb2.com`
5. Proxy status: Proxied (เมฆสีส้ม)
6. SSL/TLS mode: Full (Strict)

สร้าง Transform Rule แบบ URL Rewrite:

- เงื่อนไข: Hostname equals `cards.example.com`
- Path rewrite แบบ Dynamic:

```text
concat("/file/<bucket-name>", http.request.uri.path)
```

Rule นี้สำคัญ เพราะป้องกันไม่ให้ hostname ของเรา proxy bucket อื่นที่อยู่บน B2 origin เดียวกัน

สร้าง Cache Rule สำหรับ:

```text
Hostname equals cards.example.com
AND URI Path starts with /deck-v1/
```

ตั้ง Browser TTL และ Edge TTL เป็น 1 ปี เนื่องจาก path มี version `deck-v1` หากเปลี่ยนชุดภาพในอนาคตให้ใช้ `deck-v2` แทนการเขียนทับ cache เดิม

ทดสอบ URL:

```text
https://cards.example.com/deck-v1/major-00-fool.webp
https://cards.example.com/deck-v1/pentacles-king.webp
```

## 4. สร้าง Cloudflare D1

ล็อกอิน Wrangler:

```bash
npx wrangler login
```

สร้างฐานข้อมูล:

```bash
npx wrangler d1 create projectspace-tarot
```

คำสั่งจะคืน `database_id` ให้นำไปแทนค่า placeholder ใน:

```text
workers/tarot/wrangler.toml
```

จากนั้นรัน migration:

```bash
npm run tarot:worker:migrate
```

D1 เก็บเพียงสำรับที่สับแล้ว คำถาม และผลชั่วคราว โดย ready session หมดอายุ 10 นาที ผลสำเร็จหมดอายุ 30 นาที และ cron จะล้างข้อมูลหมดอายุทุกชั่วโมง

## 5. ตั้งค่า Cloudflare Worker

แก้ `[vars]` ใน `workers/tarot/wrangler.toml`:

```toml
[vars]
FIREBASE_PROJECT_ID = "ค่า VITE_FIREBASE_PROJECT_ID จาก .env"
ALLOWED_EMAIL_DOMAINS = "example.com"
ALLOWED_ORIGINS = "http://localhost:5173,https://<firebase-project>.web.app,https://<custom-superkanban-domain>"
KKU_API_BASE_URL = "https://<your-kku-api-host>/api/v1"
KKU_MODEL_ID = "<your-model-id>"
DAILY_READING_LIMIT = "5"
```

ข้อควรระวัง:

- `ALLOWED_ORIGINS` ต้องเป็น origin เต็ม ไม่มี `/` ท้าย URL
- ลบ custom domain ที่ไม่ได้ใช้ ไม่ต้องใส่ placeholder ค้างไว้
- `KKU_API_BASE_URL` ใช้ base URL ที่ระบุใน KKU API documentation หรือบัญชีของคุณ
- ดู string model ID ที่ใช้ได้ด้วย `GET /models` โดยใช้ KKU API key
- `DAILY_READING_LIMIT` คือจำนวนครั้งสูงสุดต่อ Firebase UID ต่อวัน ถ้าโควตาเต็ม Worker จะไม่สร้าง session ตั้งแต่กดเริ่มสับไพ่ และยังตรวจซ้ำตอนเปิดไพ่เพื่อกันหลายแท็บ ระบบรีเซ็ตเวลา 00:00 น. ประเทศไทย การ retry ไพ่ชุดเดิมไม่หักซ้ำ และถ้า AI ตอบไม่สำเร็จระบบจะคืนโควตาให้

บันทึก KKU key เป็น Cloudflare secret:

```bash
npx wrangler secret put KKU_API_KEY --config workers/tarot/wrangler.toml
```

อย่าใส่ key ลง `wrangler.toml`, `.env`, `.dev.vars.example` หรือ Git

ตรวจ Worker ก่อน deploy:

```bash
npm run tarot:worker:typecheck
XDG_CONFIG_HOME=/tmp/superkanban-wrangler npx wrangler deploy --dry-run --config workers/tarot/wrangler.toml
```

Deploy:

```bash
npm run tarot:worker:deploy
```

จด URL ที่ได้ เช่น:

```text
https://projectspace-tarot.<account>.workers.dev
```

ทดสอบ health endpoint:

```bash
curl https://projectspace-tarot.<account>.workers.dev/health
```

ควรได้ `{"ok":true}`

## 6. ตั้งค่า Frontend

เพิ่มสองบรรทัดนี้ใน `.env` จริงของ SuperKanban โดยไม่ commit ไฟล์ `.env`:

```dotenv
VITE_TAROT_API_URL=https://projectspace-tarot.<account>.workers.dev
VITE_TAROT_CDN_BASE_URL=https://cards.example.com
```

`VITE_TAROT_CDN_BASE_URL` ไม่ต้องมี `/deck-v1` และไม่ต้องมี `/` ท้าย URL เพราะแอปเติม path ให้เอง

## 7. Deploy Firestore และเว็บ

รันชุดตรวจสอบ:

```bash
npm test
npm run test:rules
npm run build
```

Deploy index, rules และ hosting:

```bash
npx firebase-tools deploy --only firestore:indexes
npx firebase-tools deploy --only firestore:rules,hosting
```

Firestore path ที่เพิ่มคือ:

```text
users/{uid}/tarotReadings/{readingId}
```

Rules อนุญาตเฉพาะเจ้าของบัญชีอ่าน สร้าง และลบ และไม่อนุญาตแก้ผลย้อนหลัง

## 8. Production smoke test

1. Login SuperKanban ด้วยบัญชีที่อนุญาต
2. กด Tarot จาก header หรือการ์ดบนหน้า Home
3. เลือกหมวดและกดสับไพ่
4. ตรวจว่าแสดงหลังไพ่ครบ 78 ใบ โดย Network response ของ `/sessions` ต้องไม่มี card ID/deck order
5. เลือกไพ่ 3 ใบและยืนยัน
6. ตรวจว่าเปิดไพ่ตามลำดับอดีต–ปัจจุบัน–อนาคตและรูปมาจาก `cards.example.com`
7. Refresh แล้วตรวจว่าประวัติยังอยู่
8. ทดลองลบหนึ่งรายการและลบทั้งหมด
9. ตรวจ Cloudflare Worker logs ว่าไม่มีคำถาม, Firebase token, deck order หรือคำทำนายถูก log

## ค่าที่ต้องเตรียมทั้งหมด

| ค่า | เก็บที่ไหน |
|---|---|
| Firebase Project ID | `wrangler.toml` และ `.env` เดิม |
| Allowed login domains | `wrangler.toml` และค่า `ALLOWED_EMAIL_DOMAINS` เดิม |
| Production frontend origins | `ALLOWED_ORIGINS` ใน `wrangler.toml` |
| D1 database ID | `wrangler.toml` |
| KKU API base URL | `wrangler.toml` |
| KKU string model ID | `wrangler.toml` |
| จำนวนครั้งดูไพ่ต่อผู้ใช้ต่อวัน | `DAILY_READING_LIMIT` ใน `wrangler.toml` |
| KKU API key | Cloudflare Worker secret เท่านั้น |
| Worker public URL | `VITE_TAROT_API_URL` ใน `.env` |
| Card CDN hostname | `VITE_TAROT_CDN_BASE_URL` ใน `.env` |
| B2 bucket name/origin | Cloudflare DNS และ Transform Rule |
