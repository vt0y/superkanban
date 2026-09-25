import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { Avatar } from '@/components/common/Avatar';
import { parseContentWithLinks } from '@/utils/linkify';
import { sendChatMessage, subscribeChatMessages } from '@/services/chat';
import type { Project, ProjectChatMessage } from '@/types';
import { attempt } from '@/components/toast';
import { pick, relativeTime } from '@/utils/formatters';

const COMPOSER_MAX_HEIGHT = 120;
const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function fitComposer(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
}

export function ProjectChat({ context, project, readOnly }: { context: AppContextValue; project: Project; readOnly: boolean }) {
  const { locale, profile, user } = context;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unread, setUnread] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const openRef = useRef(open);
  const knownIds = useRef<Set<string> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [touch] = useState(isTouch);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLoaded(false);
    return subscribeChatMessages(
      project.id,
      (next) => {
        setMessages(next);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, [open, project.id]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const frame = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      if (!touch) inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, messages.length, touch]);

  // The chat is a full-screen sheet on phones: stop the page behind it from scrolling.
  useEffect(() => {
    if (!open || !matchMedia('(max-width: 760px)').matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => fitComposer(inputRef.current), [body]);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = body.trim();
    if (!message || readOnly || busy) return;
    setBusy(true);
    const sent = await attempt(
      () =>
        sendChatMessage(project.id, message, {
          id: user.uid,
          displayName: profile.displayName,
          photoURL: profile.photoURL,
        }).then(() => true),
      pick(locale, 'ส่งข้อความไม่สำเร็จ', 'Could not send message'),
    );
    if (sent) setBody('');
    setBusy(false);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !touch) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className={`project-chat ${open ? 'open' : ''}`}>
      {open && (
        <section className="chat-panel" role="dialog" aria-modal="false" aria-label={context.t('chat')}>
          <header className="chat-header">
            <div>
              <span className="chat-project-mark" style={{ background: project.color }}>
                {project.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{context.t('chat')}</strong>
                <small>
                  {project.name} · {project.memberIds.length} {context.t('members')}
                </small>
              </span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={pick(locale, 'ปิดแชท', 'Close chat')}>
              ×
            </button>
          </header>
          <div className="chat-messages" ref={listRef}>
            {!loaded && (
              <div className="chat-state">
                <span className="loader" />
                <small>{context.t('loading')}</small>
              </div>
            )}
            {loaded && !messages.length && (
              <div className="chat-state">
                <span>💬</span>
                <strong>{context.t('noMessages')}</strong>
                <small>{pick(locale, 'เริ่มคุยกับทีมของคุณได้เลย', 'Start the conversation with your team')}</small>
              </div>
            )}
            {messages.map((message) => {
              const mine = message.createdBy === user.uid;
              return (
                <article className={`chat-message ${mine ? 'mine' : ''}`} key={message.id}>
                  {!mine && <Avatar name={message.authorName} src={message.authorPhoto} size="sm" />}
                  <div>
                    <header>
                      <strong>{mine ? pick(locale, 'คุณ', 'You') : message.authorName}</strong>
                      <time dateTime={message.createdAt?.toDate().toISOString()}>
                        {relativeTime(message.createdAt?.toDate(), locale)}
                      </time>
                    </header>
                    <p>{parseContentWithLinks(message.body)}</p>
                  </div>
                </article>
              );
            })}
          </div>
          {readOnly ? (
            <div className="chat-read-only">
              <span>📦</span>
              <div>
                <strong>{context.t('readOnly')}</strong>
                <small>{pick(locale, 'นำโปรเจกต์กลับมาใช้เพื่อส่งข้อความ', 'Unarchive this project to send messages')}</small>
              </div>
            </div>
          ) : (
            <form className="chat-composer" onSubmit={submit}>
              <textarea
                ref={inputRef}
                rows={1}
                maxLength={2000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={touch ? pick(locale, 'พิมพ์ข้อความ...', 'Write a message…') : pick(locale, 'พิมพ์ข้อความ... (Shift+Enter เพื่อขึ้นบรรทัดใหม่)', 'Write a message… (Shift+Enter for a new line)')}
                aria-label={pick(locale, 'ข้อความ', 'Message')}
              />
              <button className="primary" disabled={busy || !body.trim()} aria-label={context.t('send')}>
                ↑
              </button>
            </form>
          )}
        </section>
      )}
      <button
        type="button"
        className="chat-launcher"
        aria-expanded={open}
        aria-label={open ? pick(locale, 'ปิดแชท', 'Close chat') : context.t('chat')}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{open ? '×' : '💬'}</span>
        {!open && unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
      </button>
    </div>
  );
}
