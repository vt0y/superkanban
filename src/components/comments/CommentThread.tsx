import { useEffect, useState, type FormEvent } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { Avatar } from '@/components/common/Avatar';
import { parseContentWithLinks } from '@/utils/linkify';
import { canDeleteItem } from '@/utils/permissions';
import { addComment, deleteWorkItem, subscribeComments } from '@/services';
import type { Comment, CommentTarget, Role } from '@/types';
import { attempt } from '@/components/toast';
import { pick, relativeTime } from '@/utils/formatters';
import { Icon } from '@/components/common/Icon';

export function CommentThread({
  projectId,
  targetType,
  targetId,
  context,
  role,
  compact = false,
  readOnly = false,
  onCount,
  onClose,
}: {
  projectId: string;
  targetType: CommentTarget;
  targetId: string;
  context: AppContextValue;
  role: Role | null;
  compact?: boolean;
  readOnly?: boolean;
  /** Reports the live comment count (e.g. for a header badge). */
  onCount?: (count: number) => void;
  /** When set, shows a close button (mobile comment sheet). */
  onClose?: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const { locale, user } = context;
  useEffect(() => (targetId ? subscribeComments(projectId, targetId, setComments) : undefined), [projectId, targetId]);
  useEffect(() => onCount?.(comments.length), [comments.length, onCount]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await attempt(
      () => addComment(projectId, targetType, targetId, text, user).then(() => true),
      pick(locale, 'ส่งความคิดเห็นไม่สำเร็จ', 'Could not post comment'),
    );
    if (ok) setBody('');
    setBusy(false);
  };

  return (
    <section className={`comment-thread ${compact ? 'compact' : ''}`}>
      <h3>
        <Icon name="comment" /> {pick(locale, 'ความคิดเห็น', 'Comments')} <b>{comments.length}</b>
        {onClose && (
          <button type="button" className="comment-sheet-close" onClick={onClose} aria-label={pick(locale, 'ปิด', 'Close')}>
            <Icon name="close" />
          </button>
        )}
      </h3>
      <div className="comment-list">
        {comments.map((comment) => (
          <article key={comment.id} className={comment.createdBy === user.uid ? 'mine' : ''}>
            <Avatar name={comment.authorName} src={comment.authorPhoto} size="sm" />
            <div>
              <header>
                <strong>{comment.authorName}</strong>
                <small>{relativeTime(comment.createdAt?.toDate(), locale)}</small>
                {!readOnly && canDeleteItem(role, comment.createdBy, user.uid) && (
                  <button
                    type="button"
                    title={pick(locale, 'ลบ', 'Delete')}
                    onClick={() => {
                      if (confirm(pick(locale, 'ลบความคิดเห็นนี้?', 'Delete this comment?')))
                        void attempt(
                          () => deleteWorkItem(projectId, 'comments', comment.id),
                          pick(locale, 'ลบไม่สำเร็จ', 'Delete failed'),
                        );
                    }}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </header>
              <p>{parseContentWithLinks(comment.body)}</p>
            </div>
          </article>
        ))}
        {!comments.length && (
          <p className="muted comment-empty">
            {pick(locale, 'ยังไม่มีความคิดเห็น เริ่มให้ feedback ได้เลย', 'No comments yet — be the first to give feedback')}
          </p>
        )}
      </div>
      {!readOnly && (
        <form className="comment-form" onSubmit={submit}>
          <textarea
            rows={2}
            value={body}
            maxLength={2000}
            placeholder={pick(locale, 'เขียนความคิดเห็น… (Ctrl+Enter เพื่อส่ง)', 'Write a comment… (Ctrl+Enter to send)')}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit();
            }}
          />
          <button className="primary" disabled={busy || !body.trim()}>
            {pick(locale, 'ส่ง', 'Send')}
          </button>
        </form>
      )}
    </section>
  );
}
