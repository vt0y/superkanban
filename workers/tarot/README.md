# ProjectSpace Tarot Worker

คู่มือติดตั้งภาษาไทยแบบครบทุกขั้นตอนอยู่ที่ [`../../TAROT_SETUP_TH.md`](../../TAROT_SETUP_TH.md)

This Worker owns the hidden 78-card shuffle, one-time reveal sessions, Firebase token verification, and the KKU GenAI request. The browser never receives the deck order.

## 1. Create and migrate D1

```bash
npx wrangler d1 create projectspace-tarot
```

Copy the returned `database_id` into `wrangler.toml`, then run:

```bash
npm run tarot:worker:migrate
```

For local development, copy `.dev.vars.example` to `.dev.vars`, then run `npm run tarot:worker:migrate:local` once.

## 2. Configure Worker values

Edit the non-secret values in `wrangler.toml`:

- `FIREBASE_PROJECT_ID`: the same project used by the SPA.
- `ALLOWED_EMAIL_DOMAINS`: comma/space-separated domains, matching the frontend and Firestore Rules.
- `ALLOWED_ORIGINS`: exact comma-separated browser origins; do not use `*`.
- `KKU_API_BASE_URL`: the account-specific KKU API v1 base URL.
- `KKU_MODEL_ID`: the string model ID returned by KKU `GET /models`, for example `gpt-5.6-luna`.
- `DAILY_READING_LIMIT`: readings allowed per Firebase user per Bangkok calendar day; invalid values fall back to `5`.

Store the API key as a Worker secret:

```bash
npx wrangler secret put KKU_API_KEY --config workers/tarot/wrangler.toml
```

## 3. Test and deploy

```bash
npm run tarot:worker:typecheck
npm run tarot:worker:dev
npm run tarot:worker:deploy
```

Set `VITE_TAROT_API_URL` in the frontend environment to the deployed Worker URL, then rebuild Firebase Hosting.

## 4. Backblaze B2 card assets

Create a public B2 bucket and upload 78 public-domain Rider–Waite images as WebP files under `deck-v1/`. Filenames must match the `slug` values in `src/tarot/deck.ts`, for example:

```text
deck-v1/major-00-fool.webp
deck-v1/major-21-world.webp
deck-v1/wands-ace.webp
deck-v1/pentacles-king.webp
```

Put a proxied Cloudflare hostname in front of the B2 origin. Add a URL Transform Rule that prefixes `/file/<bucket-name>` so the hostname cannot proxy other buckets. Use Full (Strict) TLS and a cache rule for `/deck-v1/*` with a one-year browser/edge TTL. Record the source and public-domain evidence for the selected scan alongside the asset publishing process.

Set `VITE_TAROT_CDN_BASE_URL=https://<card-hostname>` in the frontend environment. The UI uses its built-in card back if an image is unavailable.

## Privacy and lifecycle

- Ready sessions expire after 10 minutes; completed results remain retryable for 30 minutes.
- Session creation is rejected immediately when the daily quota is already full. The quota is also enforced atomically at reveal time for multi-tab safety, resets at midnight in Bangkok, and does not charge again when retrying the same locked selection. A failed AI request releases its reservation.
- The hourly cron deletes expired D1 rows, including their temporary question and result.
- Firestore keeps only the user's latest 20 readings; the user can delete one or all readings.
- Worker logs intentionally exclude tokens, questions, deck order, and generated readings.
