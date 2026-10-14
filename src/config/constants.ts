import type { FeedbackCategory, FeedbackStatus, TaskStatus } from '@/types';

export const TASK_COLUMNS: { id: TaskStatus; th: string; en: string; color: string }[] = [
  { id: 'backlog', th: 'งานค้าง', en: 'Backlog', color: '#94a3b8' },
  { id: 'todo', th: 'ต้องทำ', en: 'To do', color: '#60a5fa' },
  { id: 'in_progress', th: 'กำลังทำ', en: 'In progress', color: '#f59e0b' },
  { id: 'review', th: 'ตรวจสอบ', en: 'Review', color: '#a78bfa' },
  { id: 'done', th: 'เสร็จแล้ว', en: 'Done', color: '#34d399' },
];

/** Label colors, picked in order for new labels (GitHub-like palette). */
export const LABEL_COLORS = ['#d73a4a', '#0075ca', '#a2eeef', '#7057ff', '#008672', '#e4e669', '#d876e3', '#f9a03f', '#0e8a16', '#5319e7', '#fbca04', '#b60205'];

export const PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#f43f5e', '#a855f7'];
export const NOTE_COLORS = ['#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#ede9fe'];

export const FEEDBACK_CATEGORIES: { id: FeedbackCategory; th: string; en: string; icon: string }[] = [
  { id: 'idea', th: 'ไอเดีย', en: 'Idea', icon: '💡' },
  { id: 'bug', th: 'ปัญหา', en: 'Bug', icon: '🐞' },
  { id: 'question', th: 'คำถาม', en: 'Question', icon: '❓' },
  { id: 'other', th: 'อื่น ๆ', en: 'Other', icon: '💬' },
];

export const FEEDBACK_STATUSES: { id: FeedbackStatus; th: string; en: string; color: string }[] = [
  { id: 'open', th: 'เปิด', en: 'Open', color: '#60a5fa' },
  { id: 'in_review', th: 'กำลังพิจารณา', en: 'In review', color: '#f59e0b' },
  { id: 'resolved', th: 'แก้ไขแล้ว', en: 'Resolved', color: '#34d399' },
  { id: 'declined', th: 'ไม่ดำเนินการ', en: 'Declined', color: '#94a3b8' },
];

export const USECASE_STATUS_COLORS = { open: '#94a3b8', assigned: '#f59e0b', completed: '#10b981' } as const;

/** Cloud Firestore maximum items in `in`, `not-in`, and `array-contains-any` filters. */
export const FIRESTORE_DISJUNCTION_LIMIT = 30;
