import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import type { CanvaProjectDocument, Locale } from '@/types';
import { attempt } from '@/components/toast';
import { pick } from '@/utils/formatters';
import { CanvaShortLinkError, expandCanvaShortLink, fetchCanvaDesignTitle, isLinkResolverConfigured, type CanvaShortLinkErrorCode } from '@/services/canva';
import { canvaShortLinkSlug } from '@/utils/canva-short-link';
import { canvaDefaultTitle, canvaEditUrl, parseCanvaInput, type CanvaLink, type CanvaParseError } from '@/utils/canva-link';
import { beginOptimisticDetach, type DetachAction } from './DriveAttachmentControl';

function parseErrorMessage(error: CanvaParseError, locale: Locale): string {
  if (error === 'short_link') return pick(locale, 'ลิงก์ canva.link เปิดอ่านจากเบราว์เซอร์ไม่ได้ ให้คัดลอกลิงก์เต็ม canva.com/design/…/edit แทน', 'canva.link short links cannot be resolved here. Copy the full canva.com/design/…/edit link instead.');
  if (error === 'view_link') return pick(locale, 'นี่คือลิงก์สำหรับดู ต้องใช้ลิงก์แก้ไข: แชร์ → ลิงก์การทำงานร่วมกัน → ทุกคนที่มีลิงก์ → แก้ไขได้ → คัดลอกลิงก์', 'This is a view link. Use an edit link: Share → Collaboration link → Anyone with the link → Can edit → Copy link.');
  return pick(locale, 'ไม่พบลิงก์แก้ไข Canva (https://www.canva.com/design/…/edit)', 'Not a Canva edit link (https://www.canva.com/design/…/edit)');
}

function expandErrorMessage(code: CanvaShortLinkErrorCode, locale: Locale): string {
  if (code === 'LINK_NOT_FOUND') return pick(locale, 'ลิงก์ canva.link นี้ไม่มีอยู่', 'This canva.link link does not exist');
  if (code === 'INVALID_LINK') return pick(locale, 'ลิงก์สั้นต้องอยู่ในรูป https://canva.link/<รหัส> เท่านั้น', 'Short links must be exactly https://canva.link/<code>');
  if (code === 'RATE_LIMITED') return pick(locale, 'ขยายลิงก์ถี่เกินไป รอสักครู่แล้วลองใหม่', 'Too many links expanded; wait a moment and try again');
  return pick(locale, 'ขยายลิงก์ไม่ได้ ให้เปิดลิงก์แล้วคัดลอก URL เต็มจากแถบที่อยู่มาวางแทน', 'Could not expand this link. Open it and paste the full URL from the address bar instead.');
}

/** Attaches a Canva design by its edit link. Access itself stays managed in Canva. */
export function CanvaLinkForm({ user, locale, onAttach, onCancel, autoFocus = false, renderLabels }: {
  user: User;
  locale: Locale;
  onAttach: (link: CanvaLink, title: string, labelIds: string[]) => Promise<void>;
  /** Optional label picker, rendered with the form's selected label IDs. */
  renderLabels?: (value: string[], onChange: (ids: string[]) => void) => ReactNode;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState('');
  const [title, setTitle] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleLoading, setTitleLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (input.trim() ? parseCanvaInput(input) : null), [input]);
  const link = parsed?.ok ? parsed.link : null;
  const shortLink = parsed?.ok === false && parsed.error === 'short_link' && isLinkResolverConfigured();
  const [expansion, setExpansion] = useState<{ input: string; error?: CanvaShortLinkErrorCode } | null>(null);

  // canva.link is expanded by the Worker, then replaces the input so the normal edit-link checks apply.
  useEffect(() => {
    if (!shortLink) return;
    if (!canvaShortLinkSlug(input)) { setExpansion({ input, error: 'INVALID_LINK' }); return; }
    let stale = false;
    setExpansion({ input });
    expandCanvaShortLink(user, input).then(
      ({ url }) => { if (!stale) { setExpansion(null); setInput(url); } },
      (error) => { if (!stale) setExpansion({ input, error: error instanceof CanvaShortLinkError ? error.code : 'LINK_UNRESOLVED' }); },
    );
    return () => { stale = true; };
  }, [input, shortLink, user]);
  const expanding = shortLink && expansion?.input === input && !expansion.error;
  const expandError = shortLink && expansion?.input === input ? expansion.error : undefined;

  // Fill the title from the design page once a valid edit link is in; the user's own text always wins.
  useEffect(() => {
    if (!link || titleTouched || !isLinkResolverConfigured()) { setTitleLoading(false); return; }
    let stale = false;
    setTitleLoading(true);
    void fetchCanvaDesignTitle(user, input).then((name) => {
      if (stale) return;
      setTitleLoading(false);
      if (name) setTitle(name);
    });
    return () => { stale = true; };
  }, [link?.designId, link?.editToken, titleTouched, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!link || busy) return;
    setBusy(true);
    const ok = await attempt(() => onAttach(link, title, labelIds).then(() => true), pick(locale, 'แนบงานออกแบบ Canva ไม่สำเร็จ', 'Could not attach the Canva design'));
    setBusy(false);
    if (ok) { setInput(''); setTitle(''); setLabelIds([]); setTitleTouched(false); onCancel?.(); }
  };

  return <form className="stack-form canva-link-form" onSubmit={(event) => void submit(event)}>
    <label><span className="field-name">{pick(locale, 'ลิงก์แก้ไข Canva', 'Canva edit link')}</span>
      <input type="url" value={input} autoFocus={autoFocus} onChange={(event) => setInput(event.target.value)} placeholder="https://www.canva.com/design/…/edit" spellCheck={false} />
      <small className="field-help"><span>{pick(locale, 'ใน Canva: แชร์ → ลิงก์การทำงานร่วมกัน → ทุกคนที่มีลิงก์ → แก้ไขได้ → คัดลอกลิงก์', 'In Canva: Share → Collaboration link → Anyone with the link → Can edit → Copy link')}</span></small>
    </label>
    {expanding && <small className="field-help" role="status"><span>{pick(locale, 'กำลังขยายลิงก์ canva.link…', 'Expanding canva.link…')}</span></small>}
    {parsed && !parsed.ok && !expanding && <small className="drive-folder-error" role="alert">{expandError ? expandErrorMessage(expandError, locale) : parseErrorMessage(parsed.error, locale)}</small>}
    {link && <p className="canva-detected" role="status"><span className="drive-file-icon canva" aria-hidden="true">CNV</span><span><b>{link.designId}</b><small>{link.editToken
      ? pick(locale, 'ลิงก์การทำงานร่วมกัน · ทุกคนที่มีลิงก์แก้ไขได้', 'Collaboration link · anyone with the link can edit')
      : pick(locale, 'ไม่มี token แชร์ · แก้ได้เฉพาะคนที่มีสิทธิ์ใน Canva อยู่แล้ว', 'No share token · only people with access in Canva can edit')}</small></span></p>}
    <label><span className="field-name">{pick(locale, 'ชื่อเอกสาร', 'Document title')} <i>{pick(locale, 'ไม่บังคับ', 'Optional')}</i></span>
      <input value={title} onChange={(event) => { setTitle(event.target.value); setTitleTouched(true); }} maxLength={200} placeholder={link ? canvaDefaultTitle(link.designId) : pick(locale, 'เช่น สไลด์นำเสนอ Sprint 3', 'For example: Sprint 3 pitch deck')} />
      <small className="field-help" role="status"><span>{titleLoading
        ? pick(locale, 'กำลังดึงชื่องานจาก Canva…', 'Reading the design name from Canva…')
        : pick(locale, 'ดึงชื่อจาก Canva ให้อัตโนมัติเมื่อลิงก์เปิดได้แบบไม่ต้องล็อกอิน ถ้าเว้นว่างจะใช้รหัสงาน และแก้ชื่อเล่นภายหลังได้', 'Filled in from Canva when the link opens without signing in. Leave blank to use the design ID; you can set a nickname later.')}</span></small>
    </label>
    {renderLabels?.(labelIds, setLabelIds)}
    <div className="drive-inline-actions">{onCancel && <button type="button" className="secondary small" onClick={onCancel}>{pick(locale, 'ยกเลิก', 'Cancel')}</button>}<button className="primary small" disabled={busy || !link}>{busy ? pick(locale, 'กำลังแนบ…', 'Attaching…') : pick(locale, 'แนบงาน Canva', 'Attach Canva design')}</button></div>
  </form>;
}

export function CanvaFileRow({ file, locale, uploader, canDetach, onDetach, detachLabel, iconOnlyDetach = false }: {
  file: CanvaProjectDocument;
  locale: Locale;
  uploader?: string;
  canDetach: boolean;
  onDetach: DetachAction;
  detachLabel?: string;
  iconOnlyDetach?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const name = file.nickname?.trim() || file.title;
  const access = file.canvaEditToken
    ? pick(locale, 'ทุกคนที่มีลิงก์แก้ไขได้', 'Anyone with this link can edit')
    : pick(locale, 'ต้องมีสิทธิ์ใน Canva', 'Needs access in Canva');

  return <div className="drive-file-row">
    <a className="drive-file-main" href={canvaEditUrl(file)} target="_blank" rel="noreferrer" title={pick(locale, 'แก้ไขใน Canva', 'Edit in Canva')}>
      <span className="drive-file-icon canva" aria-hidden="true">CNV</span>
      <div className="drive-file-copy"><strong>{name}</strong>{file.nickname?.trim() && <small className="drive-original-name">{file.title}</small>}{file.description?.trim() && <p className="drive-file-description">{file.description}</p>}<span className="drive-file-meta"><small>Canva</small>{uploader && <small>{uploader}</small>}<small className={`drive-access-badge ${file.canvaEditToken ? 'external' : 'unmanaged'}`} title={pick(locale, 'SuperKanban เก็บแค่ลิงก์ สิทธิ์จัดการใน Canva', 'SuperKanban stores only the link; access is managed in Canva')}>{access}</small></span></div>
      <span className="drive-open-mark" aria-hidden="true">✎</span>
    </a>
    {canDetach && <button type="button" className={`drive-detach${iconOnlyDetach ? ' icon-only' : ''}`} onClick={() => beginOptimisticDetach(onDetach, setHidden)} aria-label={detachLabel || pick(locale, `นำ ${name} ออกจาก SuperKanban`, `Remove ${name} from SuperKanban`)} title={detachLabel || pick(locale, 'นำออกจาก SuperKanban (งานใน Canva จะไม่เปลี่ยน)', 'Remove from SuperKanban (the Canva design stays unchanged)')}><span aria-hidden="true">×</span>{!iconOnlyDetach && <b>{detachLabel || pick(locale, 'นำออก', 'Remove')}</b>}</button>}
  </div>;
}
