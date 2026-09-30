# ProjectSpace

Realtime collaborative project workspace designed for agile development teams, built with React 19, TypeScript, Vite, Firebase Authentication, and Cloud Firestore.

---

## Table of Contents
1. [Overview and Architecture](#overview-and-architecture)
2. [Feature Matrix](#feature-matrix)
3. [Environment Configuration (.env)](#environment-configuration-env)
4. [GitHub Integration Setup Guide](#github-integration-setup-guide)
5. [Security Rules and Permission Model](#security-rules-and-permission-model)
6. [Performance and Bandwidth Optimizations](#performance-and-bandwidth-optimizations)
7. [Development and Testing](#development-and-testing)
8. [Deployment Guide](#deployment-guide)

---

## 1. Overview and Architecture

ProjectSpace operates as a high-performance Single Page Application (SPA) designed to run entirely within the Firebase Spark (free tier) quota while supporting multi-user realtime collaboration.

```
+--------------------------------------------------------------------------+
|                               PROJECTSPACE                               |
+--------------------------------------------------------------------------+
|  Frontend: React 19, TypeScript, React Router, Vite                      |
|  Auth: Firebase Authentication (Google OAuth + GitHub Provider Linking)  |
|  Database: Cloud Firestore with Multi-Tab IndexedDB Persistence Cache    |
|  Hosting: Firebase Hosting with Brotli Compression & Immutable Caching  |
|  Integrations: GitHub App user tokens (8h expiry) via client-side REST   |
+--------------------------------------------------------------------------+
```

---

## 2. Feature Matrix

### A. Realtime Kanban Board
- 5 workflow states: Backlog, Todo, In Progress, Review, Done.
- Drag-and-drop task movement with automatic order persistence.
- Multi-select bulk actions: batch status change, priority update, milestone assignment, assignee assignment, and deletion.
- Task search, label filters, priority filters, and assignee filters.

### B. Milestones with Dependency Graph
- Visual roadmaps with completion tracking and due dates.
- Prerequisite locking: dependent milestones are locked until prior milestones reach completion.
- Scoped milestone boards allowing focused execution per phase.

### C. Software Design & UML Modeling
- Integrated visual Use Case diagram editor (Actor, Use Case, System Boundary).
- Relationship connectors: Association, <<include>>, <<extend>>, and Generalization.
- Automatic classification of Base, Common, and Extension use cases.
- Direct use-case assignee assignment from within the diagram canvas.
- Vector export to PNG and SVG formats.

### D. Polls & Realtime Voting
- Single-choice and multiple-choice polling.
- Anonymous and public voting modes with real-time tally bars.
- Creator and admin deadline management with close/reopen controls.

### E. Realtime Project Chat
- Sliding side panel accessible across all workspace views.
- Unread message counters, autoscroll, and optimistic UI updates.

### F. Infinite Notes Canvas & Markdown Documents
- 2D pan/zoom sticky notes board with color categories and task anchoring.
- Dedicated, shareable Markdown document reader with a live editor preview and DOMPurify sanitization.
- Lazy Mermaid diagrams from fenced `mermaid` blocks, including flowchart, sequence, class, state, ER, Gantt, and other supported types.
- Egress optimization: document lists load metadata only; Markdown bodies are downloaded only when opened.

### G. Lucky Draw / Task Gacha Engine
- Fair weighted raffle system for distributing tasks among team members.
- Multi-target simultaneous draws with win-balancing mechanics.
- Interactive animation reveals (Golden Chest and Pack Opening styles).
- Immutable gacha draw audit log stored on Firestore subcollection.

### H. GitHub Integration (GitHub App)
- Permanent Google-to-GitHub identity linking via the Firebase Auth GitHub popup. Member tokens are never stored.
- **Management mode ("sudo mode")**: owners switch it on only to link a repository or manage access. It uses a GitHub App user token that GitHub expires after 8 hours, and it can be exited early.
- Repository binding limited to the repositories the owner installed the GitHub App on (public or private).
- Collaborator management (pull, triage, push, maintain, admin) with live status from GitHub: active, invitation pending, or out of sync.
- Automatic revocation: removing a member, a member disconnecting, or unlinking the repository revokes GitHub access. Anything that cannot be revoked immediately is queued for the owner.
- Anti-tampering guardrails: Firestore security rules only accept a githubUsername when the user token contains an authentic github.com identity.

### I. Identity, Roles & Internationalization
- Google Sign-In with configurable email domain restrictions.
- 3-tier role hierarchy: Project Owner, Admin, and Member.
- Dual language support: English and Thai.
- Theme switching: Light, Dark, and System modes.

### J. Mystic Cosmic AI Tarot
- Authenticated `/tarot` experience linked from ProjectSpace, with a visual identity separate from the workspace UI.
- Users choose three face-down cards from all 78 Rider–Waite cards; the hidden shuffle and reveal mapping stay in a Cloudflare Worker/D1 session.
- KKU GenAI produces a Thai or English Past–Present–Future reading through a server-side API-key proxy.
- The latest 20 readings are private to the user and may be deleted individually or together.
- Card images are designed to be served from Backblaze B2 through Cloudflare CDN; setup details are in [`workers/tarot/README.md`](./workers/tarot/README.md).
- คู่มือตั้งค่าระบบ รูปภาพ D1 Worker และ deployment ภาษาไทย: [`TAROT_SETUP_TH.md`](./TAROT_SETUP_TH.md)

---

## 3. Environment Configuration (.env)

All configuration variables and feature toggles must come strictly from `.env` files. Toggles are disabled by default.

### Environment Variables Reference Table

```
+------------------------------------+-----------+------------------------------------------------+-----------------+
| Variable Name                      | Type      | Description                                    | Default Value   |
+------------------------------------+-----------+------------------------------------------------+-----------------+
| VITE_FIREBASE_API_KEY              | string    | Firebase Web App API key                       | Required        |
| VITE_FIREBASE_AUTH_DOMAIN          | string    | Firebase Auth domain (e.g. project.firebaseapp)| Required        |
| VITE_FIREBASE_PROJECT_ID           | string    | Firebase project identifier                    | Required        |
| VITE_FIREBASE_STORAGE_BUCKET       | string    | Firebase Cloud Storage bucket                  | Required        |
| VITE_FIREBASE_MESSAGING_SENDER_ID  | string    | Cloud Messaging sender ID                      | Required        |
| VITE_FIREBASE_APP_ID               | string    | Firebase Web App identifier                    | Required        |
| VITE_FIREBASE_APPCHECK_SITE_KEY    | string    | Optional reCAPTCHA v3 key for Firebase App Check | "" (disabled) |
| ALLOWED_EMAIL_DOMAINS              | string    | Space-separated allowed email domains          | "" (allow all)  |
| CONNECTS_GITHUB                    | boolean   | Enable GitHub integration across the UI        | false (OFF)     |
| CONNECTS_GITHUB_APP_SLUG           | string    | Slug of your GitHub App (github.com/apps/<slug>)| "" (required)   |
| VITE_TAROT_API_URL                 | URL       | Deployed Cloudflare Tarot Worker                | Required for Tarot |
| VITE_TAROT_CDN_BASE_URL            | URL       | Cloudflare-proxied Backblaze B2 card origin     | Required for card art |
+------------------------------------+-----------+------------------------------------------------+-----------------+
```

### Feature Flag: CONNECTS_GITHUB
- **Disabled by default**: When `CONNECTS_GITHUB` is omitted, empty, or `false`, **or** `CONNECTS_GITHUB_APP_SLUG` is missing or invalid, all GitHub features (profile linking, settings card, team collaborator column) are hidden and dormant.
- **Enabling**: Set `CONNECTS_GITHUB=true` **and** `CONNECTS_GITHUB_APP_SLUG=<slug>` in `.env`. The `VITE_` prefixed forms are also supported.

---

## 4. GitHub Integration Setup Guide

ProjectSpace talks to GitHub through a **GitHub App**, not an OAuth App. Compared with an OAuth App:
- **Per-repository access**: owners install the App only on the repositories ProjectSpace should manage.
- **Expiring tokens ("sudo mode")**: user tokens expire 8 hours after issue, so management access switches itself off. An OAuth App's `repo` scope covers every repository and never expires.
- **No backend needed**: Firebase Auth performs the code-for-token exchange with the client secret. The app never needs the App private key, because it does not use installation tokens, and it never refreshes tokens; an expired session simply re-opens the popup.

### Step 1: Create the GitHub App
1. Open https://github.com/settings/apps/new (or your organization's Developer settings → GitHub Apps).
2. Fill in:
   - **GitHub App name**: e.g. `ProjectSpace` (its slug appears in `https://github.com/apps/<slug>`)
   - **Homepage URL**: `https://<your-project-id>.web.app`
   - **Callback URL**: `https://<your-project-id>.firebaseapp.com/__/auth/handler`
   - **Expire user authorization tokens**: ✅ ON (this is the 8-hour sudo timeout)
   - **Request user authorization (OAuth) during installation**: OFF
   - **Webhook → Active**: OFF
3. Permissions:
   - Repository → **Administration: Read and write** (add/remove collaborators, invitations)
   - Repository → Metadata: Read-only (automatic)
   - Account → **Email addresses: Read-only** (Firebase reads the account email)
4. **Where can this GitHub App be installed?** → *Any account* (so owners on other accounts and organizations can install it).
5. Create the App, then **Generate a new client secret**. Copy the **Client ID** and **Client secret**.

### Step 2: Put the App credentials into Firebase
1. Firebase Console → **Authentication** → **Sign-in method** → **GitHub**.
2. Enable it and paste the GitHub App's **Client ID** and **Client secret**, replacing any old OAuth App values.
3. Check that the callback URL shown matches `https://<your-project-id>.firebaseapp.com/__/auth/handler`, then save.

### Step 3: Configure .env and deploy
```bash
CONNECTS_GITHUB=true
CONNECTS_GITHUB_APP_SLUG=<your-app-slug>
```
Then run `npm run deploy`.

### Step 4: Retire the old OAuth App (if you used one before)
Delete it at https://github.com/settings/developers. That revokes every token it ever issued, including old tokens with `repo` scope. ProjectSpace also discards any old token still saved in a browser.

### Step 5: Using GitHub in ProjectSpace
1. **Members connect their identity**: avatar (top right) → **User Profile** → **Connect GitHub**. Only the handle and ID are saved; the token is discarded.
2. **Owner enters management mode**: Settings → GitHub → **Enter management mode**. The bar shows the time remaining and can be exited early.
3. **Install and link**: in **Link GitHub repository**, install the App on the repositories you want if you have not already, then pick one.
4. **Manage access**: Team → **GitHub access** column. Status badges show ✓ Active, ⏳ Invitation pending (the member must accept on GitHub), or ⚠ Out of sync.
5. **Revocation**: removing a member or unlinking the repository revokes access right away while management mode is on. Otherwise the access is listed under **GitHub access to revoke** in the Team page for the owner.

---

## 5. Security Rules and Permission Model

Firestore security rules ([firestore.rules](./firestore.rules)) enforce strict isolation and data integrity:

### Role Permissions
- **Owner**: Full administrative authority. Can archive projects, unarchive projects, link/unlink GitHub repositories, and assign GitHub collaborator permissions.
- **Admin**: Can manage project tasks, milestones, invitations, and member roles (Member to Admin). Cannot archive projects or manage GitHub repository bindings.
- **Member**: Can create, update, and collaborate on tasks, notes, documents, and diagrams. Can only delete work items they created.

### Anti-Tampering & Identity Verification
- **User Document Protection**: A user can only write to `users/{uid}` where `uid == request.auth.uid`. Email changes are rejected.
- **Domain Allowlist**: If `ALLOWED_EMAIL_DOMAINS` is set, `firestore.rules` rejects user profile creation from unauthorized email domains.
- **GitHub Account Proof**: In `users/{uid}` and `memberships/{id}`, setting `githubUsername` or `githubId` requires that `'github.com' in request.auth.token.firebase.identities`. An attacker cannot spoof a GitHub handle or ID without authenticating via GitHub OAuth.
- **Least privilege via GitHub App**: the App can only reach repositories an owner installed it on. Member tokens are discarded after identity linking. Owner tokens live only for a management session and expire on GitHub after 8 hours.
- **GitHub Privilege Enforcement**: Only project owners can modify `githubPermission` on membership documents.
- **GitHub Invitation Model**: When collaborator permissions are assigned, GitHub sends an invitation to the specified username. Access is only granted when that user accepts the invite on GitHub.com.

### Tarot history trust and quota trade-off

Tarot history is currently written by the browser to `users/{uid}/tarotReadings`. Firestore Rules restrict each user to their own path and validate the document shape, but they cannot prove that a submitted `requestId`, card selection, or reading was produced by the Tarot Worker. Consequently, an authenticated user from an allowed email domain can forge entries in their own history. They cannot write to another user's history, bypass the Worker's daily reading quota, or obtain additional AI readings through this path.

This is an accepted low-impact limitation while history remains private, informational data that is not used for rewards, quotas, audits, statistics, or administrative decisions. The current architecture also keeps forged-history traffic away from the shared Tarot Worker.

| Approach | Abuse boundary | Free-tier pressure |
|---|---|---|
| Browser writes history to Firestore (current) | A signed-in user can forge only their own history | Firestore Standard includes 20,000 document writes per day; direct forged writes do not consume Worker requests |
| A generic Worker history POST endpoint | Without authoritative session validation, the same abuse moves to shared Worker/D1 capacity | Workers Free includes 100,000 requests per day; D1 Free includes 100,000 rows written per day, and index updates can add row writes |
| Worker saves automatically after a successful reveal | History is authoritative and remains bounded by authentication, reveal rate limits, and the daily reading quota | Safest server-side design, but adds D1 writes and operational coupling to every successful reveal |

The Firestore approach reaches its free write allowance sooner under direct write abuse, but the blast radius is primarily Firestore. A naive Worker POST endpoint can be worse operationally because exhausting the account-wide Worker or D1 allowance can make the complete Tarot API unavailable. If history later becomes trusted business data, move persistence into the existing reveal transaction or another server-controlled flow; do not add a client-supplied generic history endpoint.

Current limits should be rechecked before an architecture change: [Firestore pricing and free quota](https://firebase.google.com/docs/firestore/pricing), [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), and [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

---

## 6. Performance and Bandwidth Optimizations

The application is tuned to minimize Firestore reads and hosting bandwidth:

1. **Scoped realtime queries**:
   Board listens to active tasks plus only the latest 50 completed tasks. Dashboard listens to active tasks and uses server aggregation for totals. Calendar reads the selected month plus active unscheduled tasks. Design listens only to the selected diagram. A refresh may still incur billed reads; IndexedDB caching does not guarantee zero reads.
2. **Cursor pagination and keep-alive subscriptions**:
   Completed tasks, closed polls, documents, and feedback load in pages of 50 with document cursors (never offsets). Identical active listeners remain attached briefly during tab switching, while the cache key includes query scope and limit.
3. **Route & Section Code Splitting**:
   Heavy modules (`SoftwareDesign`, `editor`, `gacha`) are loaded lazily on demand with `React.lazy()` and `<Suspense>`.
4. **Sourcemap Exclusion**:
   Production builds exclude `.js.map` files, saving ~5.45 MB of bandwidth per DevTools session.
5. **Immutable Asset Caching**:
   Static hashed assets in `/assets/**` are served with `Cache-Control: public, max-age=31536000, immutable`.
6. **Brotli Wire Compression**:
   Firebase Hosting serves Brotli (`Content-Encoding: br`) with an additional 13.4% size reduction over Gzip.

### Approximate reads by initial page load

| View | Initial Firestore reads |
|---|---|
| Board | active tasks + up to 50 completed + small memberships/labels/milestones |
| Dashboard | active tasks + aggregation queries + 8 activities + small collections |
| Calendar | tasks dated in selected month + active unscheduled + small collections |
| Design | diagrams/use cases + nodes and edges for the selected diagram |
| Votes | open polls + up to 50 closed polls + votes for visible polls (IDs chunked by 30) |
| Notes / Documents | sticky notes + active task choices; up to 50 document metadata records, plus one body only when opened |
| Feedback | latest 50 matching records |

Counts are upper bounds based on returned documents. Listener reconnects, local cache state, and concurrent changes can affect billing.

### App Check rollout and quota runbook

App Check is optional and disabled when `VITE_FIREBASE_APPCHECK_SITE_KEY` is empty. Authentication, the email-domain allowlist, and Firestore Rules remain the primary access controls. App Check is defense in depth against automated abuse; it does not replace authorization or reduce reads from legitimate authenticated clients.

1. To opt in, register the web app with Firebase App Check and set `VITE_FIREBASE_APPCHECK_SITE_KEY` to its reCAPTCHA v3 site key. Deploy the integration while leaving Firestore enforcement off. Development uses the App Check debug provider only when the site key is configured; register the local debug token in Firebase Console and never commit it.
2. Monitor App Check valid/invalid traffic for 7 days. Investigate unexpected invalid clients before enabling Firestore enforcement; enforcement can be disabled immediately if valid clients are rejected. When the variable remains empty, skip App Check metrics and enforcement entirely.
3. In Firebase Console → Firestore → Usage, check daily reads and writes. At 50% of the Spark allowance, review the highest-traffic views. At 70%, pause nonessential realtime additions and investigate reconnect/query regressions. At 85%, restrict optional traffic and prepare a Blaze upgrade or temporary feature flag.
4. Check Firebase Hosting transfer alongside Firestore usage, and alert on a sustained rise in App Check invalid requests. Activity, chat, and gacha history are archived without adding unbounded listeners.

---

## 7. Development and Testing

### Setup
```bash
# 1. Clone repository and install dependencies
npm install

# 2. Copy environment template and configure Firebase credentials
cp .env.example .env

# 3. Start local development server
npm run dev
```

### Running Test Suites
```bash
# Run all Vitest unit tests (17 test suites, 108 tests)
npm test

# Sync allowed email domains from .env to firestore.rules
npm run sync:rules

# Run Firestore security rules test suite in Firebase Emulator (26 tests)
npm run test:rules

# Run production build (TypeScript check, bundling, wire size report)
npm run build
```

---

## 8. Deployment Guide

### Prerequisites
1. Ensure Firebase CLI is installed and logged in:
   ```bash
   npx firebase-tools login
   ```
2. Verify project association in `.firebaserc`:
   ```json
   {
     "projects": {
       "default": "your-firebase-project-id"
     }
   }
   ```

### Deploy to Production
Deploy indexes first and wait until every index reports Ready. Then deploy Rules and Hosting:
```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules,hosting
```
Before the release, `npm run build` runs:
1. `npm run sync:rules`: Synchronizes domain allowlist into `firestore.rules`.
2. `tsc --noEmit`: Verifies TypeScript compilation without errors.
3. `vite build`: Generates optimized production assets in `dist/`.
4. `node scripts/report-bundle-size.js`: Calculates and reports Gzip and Brotli asset footprints.
5. `firebase deploy`: Deploys Firestore security rules and static hosting bundle.

---

## License
Private and confidential. ProjectSpace Workspace.
