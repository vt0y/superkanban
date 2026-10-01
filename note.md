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

## Google Workspace collaboration roles — TBD

Google Docs, Sheets, and Slides currently receive the same `reader` grants as every other attachment. Whether a future sharing design should offer viewer, commenter, or editor access—and whether those roles should differ for internal and external collaborators—remains to be determined. Do not broaden grants until that policy and its UI are explicitly designed.

Fully automatic synchronization would require an authorization-code backend, encrypted refresh-token storage, revocation handling, a membership-change queue, retries, and an audit trail. Do not add that flow until the project accepts the operational and security cost; browser access tokens cannot safely provide unattended synchronization.

# Document labels

Markdown and Google Drive documents share the project's existing labels with tasks. Active project members can assign up to 50 labels to a document; archived projects remain read-only. Existing records without `labelIds` are treated as unlabelled and do not need migration.

Documents is a standalone workspace section rather than a Notes tab. It displays labels, supports inline label editing for Markdown and Drive files, and uses the same query-style filter interaction as the task board: free text, `label:name`, `-label:name`, and `no:label`. Label queries use Firestore metadata to narrow candidates and retain 50-item pagination; free-text matching runs over loaded document metadata/content. Existing `/notes/:documentId` links redirect to `/documents/:documentId`.

Deleting a label removes its ID from every task and document before deleting the shared label record. Legacy Markdown migration and Drive permission synchronization must preserve document labels.

# Unified documents and task links

Documents is the single source of truth for Markdown and Google Drive records. A document may store up to 100 `taskIds`; Task Editor links or unlinks these records instead of creating a second task attachment. Removing a link or deleting a task never deletes the document or its Google Drive file. New uploads started from Task Editor create a normal Drive document and link it to that task. Legacy `taskAttachments` records are not migrated or rendered by the new UI.

Drive documents support project-local `nickname` and `description` fields. They do not rename the Google Drive file or alter Drive metadata. The UI displays the nickname when present and falls back to the original Drive filename. Active project members may edit document metadata and links; archived projects remain read-only.

Document search includes Drive nickname, custom description, original filename, linked task titles, and the existing document fields. Task filters use `task:"Task name"`, `-task:"Task name"`, and `no:task`. Positive task filters narrow the Firestore query; when label and task filters are combined, remaining conditions are applied to the loaded task-matched candidates because Firestore cannot use two array membership filters in one query.

# Workspace navigation order

The desktop sidebar follows daily-use workflow order:

1. Work: Dashboard, Board, Calendar, Notes, Documents
2. Plan & Design: Milestones, Design
3. Collaborate: Team, Votes, Gacha
4. Manage: Settings

Mobile keeps Dashboard, Board, Notes, Documents, and More as its primary navigation. The More sheet inherits the remaining desktop order. Existing document deep links redirect to the new Documents route.
