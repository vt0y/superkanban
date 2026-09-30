# รายงานการ Optimize ProjectSpace สำหรับ Firebase Free Tier

วันที่ประเมิน: 25 กันยายน 2026  
ขอบเขต: Firebase Spark plan, Cloud Firestore Standard edition, Firebase Authentication และ Firebase Hosting

## 1. บทสรุปสำหรับผู้ตัดสินใจ

ProjectSpace มีพื้นฐานที่เหมาะกับ Firebase Spark อยู่แล้ว เช่น แบ่งหน้าแบบ cursor, จำกัดประวัติงาน/โพล/เอกสารครั้งละ 50 รายการ, เปิด chat เมื่อผู้ใช้กดเท่านั้น, ใช้ IndexedDB multi-tab cache, lazy-load หน้าหนัก และปิด index ของข้อความขนาดใหญ่บางฟิลด์

อย่างไรก็ตาม คำว่า “50–100 users” ต้องแยกเป็น **จำนวนบัญชี**, **ผู้ใช้ต่อวัน (DAU)** และ **ผู้ใช้ที่ออนไลน์พร้อมกัน** เพราะค่าใช้จ่าย Firestore เกิดจาก reads/writes และการกระจาย realtime update ไม่ได้คิดตามจำนวนบัญชีโดยตรง

ข้อสรุป:

- **50–100 บัญชี แต่มีผู้ใช้งานจริงพร้อมกันประมาณ 10–30 คน:** ใช้ Spark ได้ค่อนข้างสบาย หากข้อมูลต่อโปรเจกต์ไม่โตผิดปกติ
- **50–100 คนออนไลน์พร้อมกัน:** ใช้ Spark ได้แบบมีเงื่อนไข ต้องทำรายการ P0 ในรายงานนี้และเฝ้าดู Usage ทุกวัน มิฉะนั้น reconnect หรือการแก้ task พร้อมกันอาจเกิน 50,000 reads/วัน
- **มากกว่า 100 คนออนไลน์พร้อมกัน:** ไม่ควรรับประกันการทำงานบน Spark ด้วยสถาปัตยกรรม realtime ปัจจุบัน ควรใช้ Blaze พร้อม budget alerts หรือเปลี่ยนบางหน้าจาก realtime เป็น on-demand/polling และทำ summary documents
- **100+ บัญชีแต่ concurrent ต่ำ:** ยังอยู่บน Spark ได้ จำนวนบัญชีไม่ใช่ปัญหาหลัก; ตัวแปรสำคัญคือ concurrent listeners, จำนวน document ที่ query คืนมา และจำนวน update ที่ fan-out ไปยังผู้ใช้

เป้าหมายที่แนะนำคือใช้ไม่เกิน **35,000 reads/วัน**, **12,000 writes/วัน** และ **7 GiB Hosting transfer/เดือน** ในภาวะปกติ เพื่อเหลือ headroom สำหรับ reconnect, rule reads, retry และวันที่มี traffic สูง

## 2. โควตาที่ใช้เป็นฐาน

โควตา Cloud Firestore แบบไม่มีค่าใช้จ่าย ณ วันที่ประเมิน:

| รายการ | Free quota |
|---|---:|
| Stored data | 1 GiB |
| Document reads | 50,000/วัน |
| Document writes | 20,000/วัน |
| Document deletes | 20,000/วัน |
| Firestore outbound transfer | 10 GiB/เดือน |

โควตารีเซ็ตประมาณเที่ยงคืนตามเวลา Pacific และมี free database ได้หนึ่งฐานข้อมูลต่อหนึ่ง project เท่านั้น การฟัง realtime คิด read ตอนรับผลครั้งแรก และคิดเพิ่มทุกครั้งที่ document ในผลลัพธ์ถูกเพิ่มหรือแก้ไข; หากเปิด offline persistence แล้ว listener หลุดเกิน 30 นาที การเชื่อมต่อกลับมาจะถูกคิดเหมือน query ใหม่ นอกจากนี้ query ว่างยังมี minimum charge อย่างน้อย 1 read และ Security Rules ที่ใช้ `get()`/`exists()` อาจเพิ่ม reads ได้

Firebase Hosting ให้พื้นที่เก็บไฟล์ฟรี 10 GB และส่งข้อมูลฟรี 10 GB/เดือน หาก Spark ใช้ data transfer ครบ เว็บไซต์อาจถูกปิดหลัง grace period จนกว่าจะขึ้นเดือนใหม่หรืออัปเกรด plan

แหล่งอ้างอิงอย่างเป็นทางการ:

- [Cloud Firestore pricing and free quota](https://firebase.google.com/docs/firestore/pricing)
- [Firebase Hosting usage, quotas, and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
- [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits)

> หมายเหตุ: Authentication ไม่ใช่คอขวดของกรณี 50–100 คนนี้ โดย Google/Social sign-in อยู่ต่ำกว่าขีดจำกัดมาก แต่หากเปิด Identity Platform บน Spark จะมีเพดาน 3,000 DAU สำหรับ provider กลุ่มทั่วไป

## 3. สิ่งที่โปรเจกต์ทำได้ดีอยู่แล้ว

1. `src/services/tasks.ts` แยก active tasks ออกจาก done tasks และจำกัด done เริ่มต้น 50 รายการ
2. `src/services/work-items.ts` ใช้ cursor (`startAfter`) แทน offset และมี shared subscription พร้อม keep-alive 30 วินาที
3. `src/services/chat.ts` จำกัด chat ล่าสุด 40 ข้อความ และ `ProjectChat` เริ่ม listener เมื่อเปิด panel เท่านั้น
4. `src/services/polls.ts` แบ่ง poll IDs เป็นชุดไม่เกิน 30 และดึง vote เฉพาะ open polls หรือ closed polls ที่ผู้ใช้ขอดูรายละเอียด
5. `src/config/firebase.ts` เปิด persistent multi-tab cache ลด query ซ้ำระหว่างหลายแท็บของ browser เดียวกัน
6. `firestore.indexes.json` ปิด single-field index ของข้อความยาว เช่น document content, comment body และ chat body ช่วยลดพื้นที่ index
7. `firebase.json` ตั้ง cache แบบ immutable ให้ hashed assets และไม่ deploy source maps
8. Production build ที่วัดในวันที่จัดทำรายงานมีขนาดรวมประมาณ **360.1 KB Brotli**; จึงยังไม่ใช่คอขวดหลักเมื่อเทียบกับ Firestore reads

## 4. จุดเสี่ยงจากโค้ดปัจจุบัน

### P0 — ต้องแก้ก่อนตั้งเป้า 50–100 concurrent users

#### 4.1 Membership listener โหลดสมาชิกทุกคนให้ผู้ใช้ทุกคน

`subscribeMemberships()` query สมาชิกทั้งโปรเจกต์ และถูก mount ตลอดเวลาที่อยู่ใน workspace ดังนั้นโปรเจกต์ 100 คนที่เปิดพร้อมกัน 100 คนจะเกิดประมาณ **10,000 document reads** เฉพาะ initial membership load (`100 × 100`) การแก้สมาชิกหนึ่ง document ยัง fan-out เป็นประมาณ 100 reads

แนวทาง:

- สร้าง `projects/{projectId}/publicMembers` หรือแบ่ง `memberSummaries` เป็น shard ละ 20–25 คนสำหรับ avatar/sidebar
- หน้า Team ค่อย paginate membership เต็มแบบ on-demand
- เก็บเฉพาะ `userId`, `displayName`, `photoURL`, `role` ใน summary; ไม่เก็บข้อมูลจัดการ GitHub ที่หน้าอื่นไม่ใช้
- ระยะสั้นจำกัดจำนวนสมาชิกต่อโปรเจกต์บน Spark เช่น 50 คน และแสดงคำเตือนเมื่อใกล้เพดาน

#### 4.2 Project document ถูกอ่านซ้ำ

`AuthGate` ฟัง query รายการ projects ของผู้ใช้ ขณะที่ `ProjectWorkspace` เปิด listener ของ project เดิมอีกครั้ง ทำให้ project document เดียวกันถูกอ่านสองสายและรับ update ซ้ำ

แนวทาง: ใช้ project จาก `context.projects` เป็นแหล่งหลัก แล้วเปิด document listener เพิ่มเฉพาะเมื่อ route ถูกเปิดจาก deep link ก่อนรายการ projects พร้อม หรือเมื่อจำเป็นต้องตรวจสิทธิ์ทันที

#### 4.3 Gacha listener ทำงานทุกหน้า

`GachaReveal` ถูก mount ใน workspace ทุก section และ `subscribeLatestGachaDraw()` เปิด listener ตลอด ถึงผู้ใช้จะไม่เคยเข้าหน้า Gacha ก็ตาม การสุ่มหนึ่งครั้งจึงกระจายอย่างน้อยหนึ่ง read ต่อผู้ใช้ออนไลน์ทุกคน

แนวทาง:

- เปิด listener เฉพาะหน้า Gacha หรือช่วงสั้น ๆ หลังผู้ใช้กดเข้าร่วม
- หากต้อง broadcast ทั้งโปรเจกต์ ให้เก็บ `latestGachaId` และ `latestGachaExpiresAt` ใน project presence/notification summary ขนาดเล็ก แล้ว fetch draw เต็มเมื่อ ID เปลี่ยน
- ปิด listener เมื่อ document หมดอายุหรือผู้ใช้กด seen ไม่ใช่เพียงซ่อน UI

#### 4.4 Realtime tasks fan-out ตามจำนวนคนที่เปิดหน้าเดียวกัน

ผู้ใช้ Board หนึ่งคนอ่าน active tasks ทั้งหมดและ done สูงสุด 50 รายการ ทุกการแก้ task ที่ยังอยู่ในผลลัพธ์คิดเพิ่มอย่างน้อยหนึ่ง read ต่อ listener และการย้าย task ระหว่าง active/done อาจกระทบทั้งสอง query ตัวอย่างขั้นต่ำ: 100 คนเปิด Board และทีมแก้ task 160 ครั้ง/วัน จะใช้ประมาณ **16,000 reads** เฉพาะ update fan-out ยังไม่รวม initial load

แนวทาง:

- สำหรับ 50–100 concurrent ให้เปิด realtime เฉพาะ task ที่อยู่ใน viewport/status ที่เลือก หรือ milestone ที่เลือก
- หน้า Dashboard ใช้ summary/counter document แทน listener active tasks ทั้งชุด
- debounce การลาก card และการพิมพ์; เขียนเมื่อ drop/blur แทนทุก pointer/input event
- พิจารณาโหมด “Refresh” หรือ refresh ทุก 30–60 วินาทีสำหรับผู้ชม read-only จำนวนมาก

#### 4.5 Milestones ยิง aggregation 2 query ต่อ milestone

หน้า Milestones เรียก `getTaskCounts()` สองครั้งต่อ milestone และทำใหม่เมื่อชุด task/status เปลี่ยน ถ้ามี 20 milestones จะมี 40 aggregation queries ต่อผู้ใช้ต่อรอบ แม้ aggregation ประหยัดกว่าดึง document ทั้งหมด แต่จำนวน request และ index reads ยังโตตามจำนวน milestone

แนวทาง:

- เก็บ `taskTotal` และ `taskDone` ใน milestone document หรือ summary document แล้วอัปเดตด้วย batch/transaction ตอน task เปลี่ยน milestone/status
- หากยังไม่ทำ counter ให้คำนวณจาก active task listener + query done รวมหนึ่งครั้ง และจำกัด refresh
- ไม่ใส่ task IDs ทั้งหมดลง summary document เพราะ document จะโตและชนเพดาน 1 MiB ในอนาคต

### P1 — ควรแก้เพื่อให้มี headroom

#### 4.6 Collections บางหน้าดึงทั้งหมดโดยไม่มี limit

`useProjectItems()` ฟังทั้ง collection สำหรับ milestones, labels, stickyNotes, useCases, diagrams และ gachaBags บางชุดยังสมเหตุผลเมื่อข้อมูลน้อย แต่ไม่มี guardrail หากโปรเจกต์ใช้งานนาน

แนวทาง:

- กำหนด product limit เช่น labels 50, milestones 50, active sticky notes 200, diagrams 50
- ใช้ `archived` + pagination สำหรับรายการเก่า
- หน้า Design ฟัง nodes/edges เฉพาะ diagram ปัจจุบันต่อไป และหน้า list ไม่ควรโหลด nodes/edges ทั้งหมด

#### 4.7 Documents query ส่ง content มาพร้อมรายการ

หน้า Notes จำกัด 50 documents แต่แต่ละ document มี `content` อยู่ใน document เดียวกัน ทำให้รายการเอกสารดาวน์โหลด body ทั้งหมด ทั้งที่ UI ต้องใช้เพียงชื่อและเวลา แม้จำนวน reads ไม่ลด การแยก metadata/body จะลด egress และ latency มาก

แนวทาง: แยกเป็น `documents/{id}` สำหรับ metadata และ `documents/{id}/content/current` สำหรับ body โหลด body เมื่อเปิด editor เท่านั้น

#### 4.8 Activity log โตไม่จำกัด

หน้า Dashboard query ล่าสุดเพียง 8 รายการจึงประหยัด reads แต่ storage จะเพิ่มตลอด และ Spark ใช้ TTL delete ไม่ได้หากไม่เปิด billing

แนวทาง: กำหนด retention เชิงผลิตภัณฑ์ เช่นเก็บ 90 วันหรือ 5,000 รายการต่อโปรเจกต์ และให้ owner ล้าง/ส่งออกแบบ manual; อย่าเปิด TTL บน Spark เพราะ TTL deletes ไม่อยู่ใน free usage

#### 4.9 Security Rules มี dependent reads

Rules ใช้ `get()` ตรวจ project, membership, profile และ poll ในหลาย operation ซึ่งอาจคิด reads เพิ่ม การ batch หลาย writes ช่วยลดการประเมินซ้ำต่อ request แต่ต้องวัดจาก Usage/Emulator ไม่ควรคาดจากจำนวน document writes อย่างเดียว

แนวทาง: ใช้ batch เท่าที่ semantic อนุญาต, หลีกเลี่ยง write ทีละรายการใน loop และเพิ่ม integration test ที่บันทึกจำนวน operations ของ workflow สำคัญ

## 5. แบบจำลอง reads สำหรับวาง capacity

ให้กำหนด:

- `U` = ผู้ใช้ออนไลน์พร้อมกัน
- `P` = จำนวน project ที่ผู้ใช้เป็นสมาชิกและถูกคืนจาก home query
- `M` = สมาชิกใน project ปัจจุบัน
- `A` = active tasks ที่ query คืนมา
- `D` = done tasks ที่โหลดครั้งแรก สูงสุด 50
- `K` = milestones
- `L` = labels
- `E` = จำนวน task updates ต่อวันขณะที่ผู้ใช้กลุ่มนี้เปิด Board

ค่าประมาณ initial reads ของผู้ใช้หนึ่งคนที่เข้า Board:

```text
R_user ≈ 4 + P + M + A + min(D, 50) + K + L
```

ค่า `4` คือ profile, site role, project detail และ latest gacha โดยยังไม่รวม minimum charges, rule-dependent reads, reconnect และ query อื่นที่ว่าง ส่วน update fan-out โดยประมาณคือ:

```text
R_updates ≈ U × E
R_day ≈ U × R_user × จำนวน full reconnect/session + R_updates + reads จากหน้าอื่น
```

ตัวอย่าง conservative สำหรับหนึ่ง project:

| สถานการณ์ | สมมติฐาน | Initial reads โดยประมาณ | ผลประเมิน |
|---|---|---:|---|
| 50 concurrent | P=1, M=50, A=100, D=50, K=10, L=10 | 11,250 | มีพื้นที่ แต่ต้องควบคุม updates/reconnect |
| 100 concurrent | P=1, M=100, A=100, D=50, K=10, L=10 | 27,500 | reconnect เต็มเพียง 2 รอบอาจเกิน quota |
| 150 concurrent | P=1, M=150, A=100, D=50, K=10, L=10 | 48,750 | initial load เกือบเต็ม quota ก่อนมี update |

ตัวเลขนี้เป็น capacity model ไม่ใช่ billing guarantee เพราะ cache state, query result, Security Rules และพฤติกรรมผู้ใช้จริงทำให้ยอดเปลี่ยนได้

## 6. เป้าหมายหลัง Optimize

### Tier A: 50–100 users

เหมาะกับ Spark เมื่อ concurrent ไม่เกินประมาณ 30 คน หรือหลังทำ P0 แล้ว concurrent สูงสุด 50–100 คนแต่ workload ไม่ถี่

งบประมาณต่อวัน:

| Metric | Target ปกติ | เริ่มลดฟีเจอร์ | Hard quota |
|---|---:|---:|---:|
| Reads | ≤35,000 | 42,500 (85%) | 50,000 |
| Writes | ≤12,000 | 17,000 (85%) | 20,000 |
| Deletes | ≤12,000 | 17,000 (85%) | 20,000 |

Product guardrails ที่แนะนำ:

- สมาชิกต่อ project ≤50 จนกว่าจะมี member summary/pagination
- active tasks ต่อ scope ≤100; เตือนให้แบ่ง milestone เมื่อสูงกว่า 150
- done tasks เริ่มต้น 25–50 และโหลดเพิ่มด้วย cursor
- milestones ≤50, labels ≤50, sticky notes ที่ active ≤200
- chat ล่าสุด 40 ตามเดิม และไม่เปิด listener จนกด panel
- จำกัด document list 25–50 metadata และโหลด body เมื่อเปิด

### Tier B: 100+ users

ถ้าหมายถึง 100+ บัญชีและ concurrent ต่ำ ใช้ Tier A ต่อได้ แต่ถ้าหมายถึง 100+ concurrent:

1. ทำ P0 ครบทั้งหมด
2. ใช้ summary documents สำหรับ dashboard, membership และ milestone counts
3. แยก read-only viewers ออกจาก realtime editors
4. เปิด realtime ตาม section/viewport และหยุด listener เมื่อ tab/browser ถูกซ่อนหาก UX ยอมรับได้
5. ทำ load test ด้วย Emulator และทดสอบอย่างน้อย 1.5 เท่าของ peak ที่คาด
6. อัปเกรด Blaze ก่อน production launch แม้คาดว่ายังอยู่ใน free allowance เพื่อไม่ให้บริการหยุดทันทีเมื่อเกินโควตา พร้อมตั้ง budget alerts; budget alert ไม่ใช่ hard spending cap

Spark เหมาะกับ prototype หรือทีมขนาดเล็ก แต่ไม่ควรเป็น SLA สำหรับ 100+ concurrent realtime collaborators

## 7. แผนดำเนินงานตามลำดับ

### Phase 1 — วัดผลและตัด reads ที่ไม่จำเป็น (1–2 วัน)

- เพิ่ม environment flag สำหรับเปิด/ปิด global Gacha broadcast
- reuse project จาก context และลด project listener ซ้ำ
- ทำ listener registry/telemetry ฝั่ง development แสดง active listener count ต่อหน้า
- บันทึก baseline จาก Firebase Console: reads, writes, deletes, storage และ transfer ต่อวัน
- กำหนด traffic scenario มาตรฐาน: login → dashboard → board → edit task → chat → logout

ผลที่ต้องได้: ทราบ reads/session ของแต่ละหน้าและไม่มี background listener ที่ไม่ได้ใช้

### Phase 2 — ลด fan-out และ collection growth (3–5 วัน)

- ทำ member summary + Team pagination
- ทำ milestone task counters แบบ atomic
- แยก document metadata ออกจาก content
- เพิ่ม limit/archive ให้ sticky notes, use cases และ diagrams
- เพิ่ม retention workflow สำหรับ activities, chat และ gacha history

ผลที่ต้องได้: initial reads ไม่โตเป็น `U × M` และหน้า Milestones ไม่ยิง `2 × K` aggregations ต่อผู้ใช้

### Phase 3 — รองรับ 100+ (ก่อน production scale)

- ทำ dashboard summary document เช่น counts ต่อ status, overdue, active milestones และ last activity summaries
- จำกัด realtime เฉพาะ editor; viewer ใช้ refresh/on-demand
- ทำ synthetic load test 150 concurrent clients
- เปิด App Check แบบ observe ก่อน แล้วจึง enforce หลัง valid traffic เสถียรอย่างน้อย 7 วัน
- เตรียม Blaze, budget alerts และ runbook เมื่อ usage ถึง 70%, 85% และ 95%

## 8. Runbook การเฝ้าระวัง

ตรวจ Firebase Console ทุกวันในช่วง rollout:

- **50% reads (25,000):** ตรวจหน้าที่ traffic สูงและ listener ที่ reconnect
- **70% reads (35,000):** หยุดเพิ่ม realtime feature, ลด page size และปิด optional listener
- **85% reads (42,500):** เปิด degraded mode เช่น manual refresh สำหรับ history/votes/gacha และเตรียม Blaze
- **95% reads (47,500):** จำกัดการเข้า section ที่ไม่จำเป็นหรืออัปเกรดทันทีเพื่อหลีกเลี่ยง outage

ติดตามอย่างน้อย:

- reads/writes/deletes ต่อ DAU
- peak concurrent users และ active listeners ต่อ route
- average documents returned ต่อ query
- reconnects ต่อ session
- Firestore storage รวม indexes
- Hosting transfer ต่อเดือน
- App Check valid/invalid traffic หากเปิดใช้

## 9. เกณฑ์ยอมรับก่อนประกาศรองรับ

### ประกาศรองรับ 50–100 users ได้เมื่อ

- load test ตามพฤติกรรมจริง 100 sessions แล้วประมาณการไม่เกิน 35,000 reads/วัน
- reconnect สองรอบต่อ session แล้วยังไม่เกิน 42,500 reads/วัน
- ไม่มี unbounded query ใน route ที่ใช้ประจำ
- หน้า Board, Dashboard และ Team มี p95 load time ตามเป้าหมายของทีม
- Firestore Rules tests และ production build ผ่าน

### ประกาศรองรับ 100+ concurrent users ได้เมื่อ

- initial membership cost ไม่เป็น `U × M`
- dashboard และ milestone counts อ่านจาก summary/counter
- test 150 concurrent users ผ่านโดยมี headroom อย่างน้อย 30%
- มี Blaze fallback, budget alerts, quota runbook และผู้รับผิดชอบ incident ชัดเจน

## 10. คำแนะนำสุดท้าย

สำหรับ release ถัดไป ควรระบุอย่างตรงไปตรงมาว่า:

> “รองรับ 50–100 registered users บน Firebase Spark สำหรับทีมที่มี concurrent usage ปานกลาง หลังเปิดใช้ query limits และ monitoring; การใช้งาน 100+ คนพร้อมกันหรือ collaboration ที่แก้ไขถี่ แนะนำ Firebase Blaze และ summary-based architecture”

ข้อความนี้แม่นยำกว่าการรับประกันจากจำนวนบัญชีเพียงอย่างเดียว และสะท้อนข้อจำกัดจริงของ realtime Firestore
