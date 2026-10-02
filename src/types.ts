import type { Timestamp } from 'firebase/firestore';

export type Role = 'owner' | 'admin' | 'member';
export type SiteRole = 'owner' | 'admin';
export type Locale = 'th' | 'en';
export type ThemeMode = 'system' | 'light' | 'dark';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  photoURL: string;
  locale: Locale;
  theme: ThemeMode;
  githubUsername?: string;
  githubId?: string;
  githubConnectedAt?: Timestamp;
  createdAt?: Timestamp;
}

export interface ProjectGitHubRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  /** 'User' repos only allow write collaborators; roles like read/maintain need an organization. */
  ownerType?: 'User' | 'Organization';
  defaultBranch?: string;
  linkedAt?: Timestamp;
  linkedBy?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  ownerId: string;
  memberIds: string[];
  archived: boolean;
  githubRepo?: ProjectGitHubRepo | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Membership {
  id: string;
  projectId: string;
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
  role: Role;
  githubUsername?: string;
  githubId?: string;
  githubPermission?: 'pull' | 'triage' | 'push' | 'maintain' | 'admin' | null;
  joinedAt?: Timestamp;
  inviteId?: string;
}

export interface GitHubRevocation {
  id: string;
  githubUsername: string;
  userId: string;
  displayName: string;
  permission: NonNullable<Membership['githubPermission']>;
  repoOwner: string;
  repoName: string;
  reason: 'removed' | 'disconnected' | 'unlinked';
  createdBy: string;
  createdAt?: Timestamp;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeIds: string[];
  tags: string[];
  labelIds?: string[];
  checklist?: ChecklistItem[];
  dueDate: string;
  dueTime?: string;
  milestoneId: string;
  order: number;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  description: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  dueTime?: string;
  status: 'active' | 'completed';
  dependsOn?: string[];
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ProjectSummaryTask {
  title: string;
  status: Exclude<TaskStatus, 'done'>;
  priority: Priority;
  dueDate: string;
  dueTime: string;
  assigneeIds: string[];
  milestoneId: string;
}

export interface ProjectSummaryMilestone {
  title: string;
  dueDate: string;
  dueTime: string;
  status: Milestone['status'];
  dependsOn: string[];
}

/** Compact read model used by Home, Overview and Milestones. */
export interface ProjectSummary {
  version: 1;
  openTasks: Record<string, ProjectSummaryTask>;
  openCount: number;
  openByStatus: Record<Exclude<TaskStatus, 'done'>, number>;
  openByMilestone: Record<string, number>;
  truncated: boolean;
  milestones: Record<string, ProjectSummaryMilestone>;
  doneTotal: number;
  doneByMilestone: Record<string, number>;
  rebuiltAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ProjectUseCase {
  id: string;
  code: string;
  title: string;
  actor: string;
  details: string;
  businessRules: string[];
  assigneeId: string;
  status: 'open' | 'assigned' | 'completed';
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StickyNote {
  id: string;
  content: string;
  color: string;
  x: number;
  y: number;
  taskId: string;
  pinned: boolean;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Sharing the app applies when it can manage the file's Drive permissions. */
export type DriveShareMode = 'members' | 'link';
/** `unmanaged` marks a pasted link the app cannot read under drive.file; access stays in Google Drive. */
export type DriveAccessMode = DriveShareMode | 'unmanaged';
export type DriveRole = 'reader' | 'commenter' | 'writer';

export interface DriveFileRef {
  driveFileId: string;
  name: string;
  /** Project-local display name; never renames the Google Drive file. */
  nickname?: string;
  /** Project-local context; never writes to Google Drive metadata. */
  description?: string;
  mimeType: string;
  sizeBytes?: number;
  shareMode: DriveAccessMode;
  /** Role of app-created grants; missing means `reader`. Never set for unmanaged references. */
  role?: DriveRole;
  sharedMemberIds: string[];
  /** Drive permission IDs created by this app, keyed by ProjectSpace user ID. */
  managedPermissionIds?: Record<string, string>;
  /** The anyone-with-link permission ID, recorded only when this app created it. */
  linkPermissionId?: string;
  permissionsSyncedAt?: Timestamp;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MarkdownProjectDocument {
  id: string;
  kind?: 'markdown';
  title: string;
  labelIds?: string[];
  taskIds?: string[];
  /** Present only on legacy records until their first v2 migration. */
  content?: string;
  schemaVersion?: 2;
  excerpt?: string;
  contentBytes?: number;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DriveProjectDocument extends DriveFileRef {
  id: string;
  kind: 'drive';
  title: string;
  labelIds?: string[];
  taskIds?: string[];
}

/** A link-only Canva design. Stores IDs and share tokens; URLs are rebuilt, never trusted from storage. */
export interface CanvaProjectDocument {
  id: string;
  kind: 'canva';
  title: string;
  /** Project-local display name; never renames the Canva design. */
  nickname?: string;
  description?: string;
  labelIds?: string[];
  taskIds?: string[];
  canvaDesignId: string;
  /** Collaboration-link token from `/design/<id>/<token>/edit`; absent when editing relies on Canva team access. */
  canvaEditToken?: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type ProjectDocument = MarkdownProjectDocument | DriveProjectDocument | CanvaProjectDocument;

export interface ProjectDocumentBody {
  content: string;
}

export interface LoadedProjectDocument extends MarkdownProjectDocument {
  content: string;
}

export interface Activity {
  id: string;
  type: string;
  messageTh: string;
  messageEn: string;
  actorUid: string;
  actorName: string;
  targetId: string;
  createdAt?: Timestamp;
}

export type GachaTargetType = 'task' | 'useCase';

export interface GachaMemberSnapshot {
  userId: string;
  displayName: string;
  photoURL: string;
}

export interface GachaTargetResult {
  targetType: GachaTargetType;
  targetId: string;
  targetTitle: string;
  winnerCount: number;
  previousAssigneeIds: string[];
  eligibleIds: string[];
  odds: Record<string, number>;
  winnerIds: string[];
}

export interface GachaDraw {
  id: string;
  candidateIds: string[];
  winnerIds: string[];
  targetIds: string[];
  candidates: GachaMemberSnapshot[];
  results: GachaTargetResult[];
  initiatedBy: string;
  initiatedByName: string;
  poolKey: string;
  animationVersion: number;
  animationStyle: 'golden' | 'pack';
  createdAt?: Timestamp;
}

export interface GachaBag {
  id: string;
  candidateIds: string[];
  winCounts: Record<string, number>;
  updatedAt?: Timestamp;
}

export interface ProjectChatMessage {
  id: string;
  body: string;
  authorName: string;
  authorPhoto: string;
  createdBy: string;
  createdAt?: Timestamp;
}

export interface Invite {
  id: string;
  projectId: string;
  projectName: string;
  role: Exclude<Role, 'owner'>;
  status: 'active' | 'revoked';
  createdBy: string;
  /** Inviter's display name; missing on invites created before it was recorded. */
  createdByName?: string;
  createdAt?: Timestamp;
  expiresAt: Timestamp;
}

export interface PollOption { id: string; label: string }

export interface Poll {
  id: string;
  question: string;
  description: string;
  options: PollOption[];
  multiple: boolean;
  anonymous: boolean;
  closed: boolean;
  deadline: string;
  deadlineTime?: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PollVote {
  id: string;
  pollId: string;
  userId: string;
  optionIds: string[];
  updatedAt?: Timestamp;
}

export type CommentTarget = 'task' | 'useCase' | 'diagram' | 'milestone';

export interface Comment {
  id: string;
  targetType: CommentTarget;
  targetId: string;
  body: string;
  authorName: string;
  authorPhoto: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type FeedbackCategory = 'idea' | 'bug' | 'question' | 'other';
export type FeedbackStatus = 'open' | 'in_review' | 'resolved' | 'declined';

/** Feedback about ProjectSpace itself (top-level `siteFeedback`), not tied to a project. */
export interface SiteFeedback {
  id: string;
  title: string;
  body: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  page: string;
  adminReply: string;
  userId: string;
  userName: string;
  userEmail: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Diagram {
  id: string;
  title: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type DiagramNodeKind = 'actor' | 'usecase' | 'boundary' | 'note';
export type DiagramEdgeKind = 'association' | 'include' | 'extend' | 'generalization';

export interface DiagramNode {
  id: string;
  diagramId: string;
  kind: DiagramNodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  useCaseId: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DiagramEdge {
  id: string;
  diagramId: string;
  from: string;
  to: string;
  kind: DiagramEdgeKind;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
