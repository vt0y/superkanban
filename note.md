# Google Drive attachment follow-ups

Drive authorization remains browser-only. New attachment batches default to current project members, while anyone-with-the-link sharing remains an explicit external-access option. SuperKanban does not retain OAuth tokens or change Drive permissions unattended.

## Known membership limitation

- Membership changes do not update Drive automatically. Upload panels and Project Settings provide an uploader-triggered **Sync access for my files** action for files owned by that user in the current project.
- Sync adds missing current members and removes former-member permissions only when SuperKanban recorded the permission ID at creation time.
- Legacy attachments can gain missing members, but historical permissions cannot be safely removed when their IDs were never recorded.
- Detaching a reference or deleting its task never deletes the Drive file or changes its remaining Drive permissions.
- Existing Drive files may already have permissions that were not created by SuperKanban. Those permissions must never be revoked implicitly.

## Detach permission cleanup — deferred

Detaching currently deletes the SuperKanban reference and its saved `managedPermissionIds`, but leaves the Drive file and every Drive permission unchanged. A future cleanup flow must distinguish app-created member grants and app-created link access from permissions that already existed or were added manually.

The same Drive file can be referenced by multiple documents or tasks. Permission cleanup therefore cannot run on every detach: it must identify the final relevant reference and safely retain or transfer the permission-management metadata while other references remain. The design must also define concurrency and failure behavior before any revocation is implemented.

## Safe upgrade path

The implemented manual sync compares the saved member snapshot with current project membership while the owner is online and has authorized Drive. It stores permission IDs returned for new grants and never infers ownership of an existing permission from an email address alone. Anyone-with-the-link attachments are outside member synchronization.

## Google Workspace collaboration roles

Each Drive document stores a `role` (`reader`, `commenter`, or `writer`). A missing `role` means `reader`, so legacy records need no migration. The role applies only to grants SuperKanban creates.

- Only Google Docs, Sheets, and Slides (`application/vnd.google-apps.document|spreadsheet|presentation`) can receive `commenter` or `writer`. Every other file stays `reader`.
- **Project members** can receive Viewer, Commenter, or Editor. **Anyone with the link** is capped at Commenter and never receives `writer`. Firestore rules enforce both limits.
- New uploads and picked files default to Viewer. Files created from SuperKanban default to Editor (members mode).
- Only the person who attached the file can change its role later, and only when they own it in Drive (Document details → Google Drive access). The change PATCHes the recorded `managedPermissionIds` (members) or `linkPermissionId` (link mode, recorded for new grants only) first, then writes Firestore. If the Firestore write fails, Drive is reverted.
- **Sync access for my files** grants new members the document's role and moves managed grants to that role. Permissions SuperKanban did not create are never upgraded, downgraded, or removed, even if they differ from the policy.
- Link-mode documents created before `linkPermissionId` existed cannot change role from SuperKanban.

## Creating Google files

Documents and Task Editor can create a blank Google Doc, Sheet, or Slides file in the uploader's `SuperKanban/<project>` folder. Files the app creates stay accessible under `drive.file`, so creation, sharing, and later role changes need no Picker.

## Picker on hardened browsers

On privacy-hardened browsers (Firefox strict / Total Cookie Protection, LibreWolf, Brave), Google Picker can show **Sign in** even when third-party cookies are allowed for google.com. The Picker is a `docs.google.com` iframe inside our origin, and storage partitioning still hides the user's Google session from it. Clicking Sign in opens the Picker in a new top-level tab with no opener link back to SuperKanban, so the selection callback never fires. The app cannot fix this: any Picker, even in a popup we open, is still a partitioned iframe.

The Picker is therefore never the only route:

- **Upload from device** and **New Google file** call `googleapis.com` directly with the OAuth token. They need no Picker and no third-party cookies.
- **Paste link** accepts `docs.google.com/{document|spreadsheets|presentation}/d/<id>` and `drive.google.com/file/d/<id>` (or `open?id=`). Folders and other hosts are rejected.
  - If `drive.file` can already read the file (it was created, uploaded, or picked here before), the file is attached normally with managed sharing.
  - Otherwise (403/404) it is saved as an **unmanaged reference** (`shareMode: 'unmanaged'`): no grants, no `role`, no `managedPermissionIds`, and no member sync. The display name comes from the user. The UI shows "Access managed in Google Drive", and people who cannot open it must request access from the owner in Drive.
- The Picker stays as **Choose from Drive**, with an inline hint pointing to Paste link.

Deferred: a Drive UI "Open with" integration (Google Workspace Marketplace SDK) grants `drive.file` access through top-level navigation with no iframe. It is the only cookie-free way to get *managed* access to existing files, but it needs Marketplace configuration and an app listing.

Fully automatic synchronization would require an authorization-code backend, encrypted refresh-token storage, revocation handling, a membership-change queue, retries, and an audit trail. Do not add that flow until the project accepts the operational and security cost; browser access tokens cannot safely provide unattended synchronization.

# Canva integration — research (2026-10)

No code yet. Researched options, from cheapest to most expensive:

## 1. Edit-link document (no backend) — implemented

Canva documents are for **editing**, not viewing. The first view/embed version (title from embed code, inline `?embed` preview, optional edit-link opt-in) was removed on 2026-10-01.

- `kind: 'canva'`, ID `canva_<designId>` (re-attaching only adds work links). Fields: `title`, `nickname`, `description`, `labelIds`, `taskIds`, `milestoneIds`, `canvaDesignId`, optional `canvaEditToken`.
- Only edit links are accepted: `https://www.canva.com/design/<id>/<token>/edit` (collaboration link: Share → Anyone with the link → Can edit) or tokenless `…/design/<id>/edit` for designs shared through Canva teams. View links, embed HTML and `canva.link` short links are rejected.
- The edit URL is rebuilt from the stored ID and token; rows open the Canva editor in a new tab. No preview.
- Edit links contain no title, so the title is optional and defaults to `Canva · <designId>`; members can set a nickname later.
- Rules (`validCanvaDocument()`): strict allowlist, `itemId == 'canva_' + canvaDesignId`, `matches()` on the ID and token. Only `nickname`, `description`, `labelIds`, `taskIds`, `milestoneIds` and `updatedAt` can change, so the token cannot be added, swapped or removed after creation (detach and re-attach instead).
- Code: `src/utils/canva-link.ts`, `src/services/canva.ts`, `src/components/common/CanvaLinkControl.tsx`.
- Limits: SuperKanban cannot grant or revoke Canva access. Anyone holding a collaboration link can edit; resetting that link in Canva is the only revocation.
- `canva.link` short links are expanded by the tarot Worker route `POST /v1/links/canva/resolve` (`src/utils/canva-short-link.ts`). Input must be exactly `https://canva.link/<slug>` (no query, hash, port, userinfo; wrappers like `google.com/url?q=` are rejected); the Worker rebuilds that URL from the slug, makes one request with redirects disabled, and returns the `Location` only if it is an `https://www.canva.com/design/...` path — the Location itself is never fetched. Order of checks: origin → Firebase token/domain → per-user rate limit (10/min) → slug validation → cache → one fetch.
- Titles: for edit links the Worker asks Canva's oEmbed API first — `https://api.canva.com/_spi/presentation/_oembed?format=json&url=<edit URL rebuilt from the validated ID and token>` — which returns the design name for "anyone with the link" designs. The editor page (`https://www.canva.com/design/<id>[/<token>]/edit`, whose `<title>` is the design name for anonymous browsers) is only a fallback: canva.com answers Cloudflare Worker traffic with 429 (verified 2026-10-01). Both use redirects disabled, a fixed host, a browser User-Agent, and read at most 64 KB; titles are decoded, stripped of a trailing " - Canva", and generic names rejected. Any failure yields an empty title and the form falls back to `Canva · <designId>`. `POST /v1/links/canva/title` does the same for pasted full edit links. Titles are cached 1 day; definite misses 10 minutes in memory only; 429/5xx/timeouts are never cached.
- Caching: browser keeps one result per slug / edit link per session (an expanded short link seeds the title cache, so no second call); the Worker keeps an in-isolate cache (1,000 entries; links 7 days, unknown slugs 1 hour, transient failures never cached). The Worker also uses the Cache API, which does work on `*.workers.dev` (confirmed in logs) and outlives deploys — bump `CACHE_VERSION` in `src/utils/canva-short-link.ts` to invalidate it. Empty titles are never written to the edge cache. Cost on the free tier: about 2 requests per uncached resolve; unauthenticated hits are rejected before any outbound fetch but still count toward the 100k/day request quota (same exposure as tarot).

**Cloudflare Worker (available, deliberately unused).** If real titles, thumbnails, a "my designs" picker, creating designs, or return navigation are needed later, use a Worker following the `workers/tarot` pattern (Firebase ID-token verification + origin allowlist) as a stateless Connect API OAuth exchange: the client secret lives in Worker secrets and access tokens stay in browser memory, so the no-stored-tokens policy holds. Canva's public-integration review (or Enterprise) is still required before other members can use it, and the Connect API still cannot share designs with other users.

## 2. oEmbed metadata proxy (small backend, no user tokens)

- Canva's oEmbed endpoint is `https://api.canva.com/_spi/presentation/_oembed?url=<design url>` (replaced `www.canva.com/_oembed` in mid-2024). It returns title, thumbnail, and embed HTML for publicly embeddable designs.
- Tested 2026-10: it sends no `Access-Control-Allow-Origin` for third-party origins, so the browser cannot call it directly. It would need a Cloud Function proxy (Firebase Blaze plan). No OAuth or stored tokens are involved, so it does not conflict with the token policy.

## 3. Connect API (full integration; conflicts with current policy)

- OAuth authorization code + PKCE. The token endpoint requires the client secret (HTTP Basic) and is CORS-blocked for browsers, so it needs a backend. Refresh tokens are single-use and rotate, so encrypted storage plus rotation handling is required.
- Capabilities: list/get designs (`design:meta:read`; `edit_url`/`view_url` valid for 30 days and **only for the requesting user**; thumbnail URLs expire after 15 min; 100 req/min/user), export to PDF/PNG (could be pushed into Drive), comments, webhooks, and **return navigation** (a "back to SuperKanban" button in the Canva editor).
- Distribution: a **public** integration needs Canva review. A **private** integration is limited to a team on **Canva Enterprise**.
- Every project member would need their own Canva account and grant. The temporary per-user URLs cannot be stored and shared as project links.
- The Canva Button (embedded editor, anonymous users) was retired on 2025-12-30 outside China and is no longer an option.

## Recommendation
Build option 1 first. Add option 2 only if the manual title and missing thumbnail prove annoying. Defer option 3 under the same terms as fully automatic Drive sync: it needs a token backend, a review or an Enterprise plan, and Canva accounts for every member.

# Document labels

Markdown and Google Drive documents share the project's existing labels with tasks. Active project members can assign up to 50 labels to a document; archived projects remain read-only. Existing records without `labelIds` are treated as unlabelled and do not need migration.

Documents is a standalone workspace section rather than a Notes tab. It displays labels, supports inline label editing for Markdown and Drive files, and uses the same query-style filter interaction as the task board: free text, `label:name`, `-label:name`, and `no:label`. Label queries use Firestore metadata to narrow candidates and retain 50-item pagination; free-text matching runs over loaded document metadata/content. Existing `/notes/:documentId` links redirect to `/documents/:documentId`.

Deleting a label removes its ID from every task and document before deleting the shared label record. Legacy Markdown migration and Drive permission synchronization must preserve document labels.

# Unified documents and work links

Documents is the single source of truth for Markdown and Google Drive records. A document may store up to 100 `taskIds`; Task Editor links or unlinks these records instead of creating a second task attachment. Removing a link or deleting a task never deletes the document or its Google Drive file. New uploads started from Task Editor create a normal Drive document and link it to that task. Legacy `taskAttachments` records are not migrated or rendered by the new UI.

Documents may also store up to 100 `milestoneIds`. Document editors and Milestone details manage the same relationship from either side. Deleting a milestone removes its ID from linked documents first and never deletes a document or its external source. Missing `milestoneIds` means no milestone links, so existing records require no migration.

Drive documents support project-local `nickname` and `description` fields. They do not rename the Google Drive file or alter Drive metadata. The UI displays the nickname when present and falls back to the original Drive filename. Active project members may edit document metadata and links; archived projects remain read-only.

Document search includes Drive nickname, custom description, original filename, linked task and milestone titles, and the existing document fields. Work filters use `task:"Task name"`, `milestone:"Milestone name"`, their negated forms, and `no:task` / `no:milestone`. Server-side narrowing uses task, then milestone, then label links; remaining conditions are applied to loaded candidates because Firestore cannot use multiple array-membership filters in one query.

# Workspace navigation order

The desktop sidebar follows daily-use workflow order:

1. Work: Dashboard, Board, Calendar, Notes, Documents
2. Plan & Design: Milestones, Design
3. Collaborate: Team, Votes, Gacha
4. Manage: Settings

Mobile keeps Dashboard, Board, Notes, Documents, and More as its primary navigation. The More sheet inherits the remaining desktop order. Existing document deep links redirect to the new Documents route.

# Project summary: offline-write alternative

The current project summary is maintained with Firestore transactions. This keeps counters exact when multiple people edit concurrently, but transactions need a live connection and add a read of the previous work item plus the summary document.

If offline task editing or transaction latency becomes more important, switch to **batch + previous values from the caller**:

- Every task/milestone caller passes the last value it rendered (`before`) to the service.
- The service computes the same summary transition and keeps using `writeBatch`, so writes queue offline and require no transaction read.
- All write paths must participate (Task editor, drag/drop, bulk actions, Calendar, Gacha, delete/unlink and milestone editing). There are roughly ten call sites.
- A stale client can calculate the wrong delta, so counters may drift until the version/7-day rebuild repairs them.

Prefer this alternative only when offline editing is a product requirement or measured transaction latency is unacceptable. Keep the current transaction strategy for stronger concurrent correctness.

# Multiple sticky cards for the same document — implemented

Each new document card has a generated sticky-note ID and an immutable `documentId` reference. Existing `document_<documentId>` cards remain valid without migration.

## Behavior

- Each card owns its position, color, pinned/locked state, creator, and timestamps. Updating or removing a copy does not change other copies or the source document.
- The Notes document picker includes already-pinned documents and shows their current copy counts. Each submission creates one additional card per selected document. Adding copies is picker-only, with no count limit or clutter warning.
- Unpinning uses the card ID. Markdown deletion, Drive/Canva detachment, and bulk document removal delete library metadata (and app-owned Markdown bodies) first, blocking concurrent new copies through Firestore rules, then remove all matching cards in server-read batches of up to 450. The default single-field `stickyNotes.documentId` index supports cleanup; no composite index is required.
- Cleanup failure provides a persistent retry action for the current app session. Retry only repeats card cleanup, so it works after metadata is gone. Reloading closes the retry notification; an interrupted session can leave invisible orphan cards, which can be cleaned using the document-ID cleanup service. External source files and permissions are never changed.
- Firestore rules allow generated and legacy IDs, require an existing source document on creation, and preserve immutable document reference, ownership, and creation time. Deploy these rules before the updated client.
- Document metadata subscriptions are deduplicated across copies; Markdown bodies are not loaded by the canvas.

## Limits and tradeoffs

Duplicate cards add small metadata reads, writes, and index storage. Copies remain unlimited; there is no server-side counter.

## Notes canvas bulk selection

Select mode supports sticky notes and document cards with checkboxes, selected outlines, Select all, and Clear. Selected items can be recolored, locked/unlocked, or removed together. Item dragging and opening are disabled in Select mode; canvas pan/zoom remain available. Group dragging and marquee selection are deferred.

Bulk removal deletes sticky notes and removes document cards without deleting library documents. Active members may remove document cards; sticky-note deletion keeps the creator/admin/owner policy. Unauthorized notes are skipped and counted in the confirmation and result. Archived projects remain read-only.
