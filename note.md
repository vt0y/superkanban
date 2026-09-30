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
