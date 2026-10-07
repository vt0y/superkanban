import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { acceptInvite, subscribeInvite } from '@/services/invites';
import type { Invite } from '@/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { Icon } from '@/components/common/Icon';
import { pick } from '@/utils/formatters';
import { useInviteClock } from '@/hooks/useInviteClock';
import { inviteState } from '@/utils/invite-state';
import { inviteErrorMessage } from '@/utils/invite-errors';

export function InviteAccept({ context }: { context: AppContextValue }) {
  const { inviteId = '' } = useParams();
  const navigate = useNavigate();
  const { locale } = context;
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, []);

  const [retry, setRetry] = useState(0);
  const [subscriptionError, setSubscriptionError] = useState(false);
  const accepting = useRef(false);
  const routeId = useRef(inviteId);
  routeId.current = inviteId;
  useEffect(() => {
    setInvite(undefined); setError(''); setBusy(false); accepting.current = false; setSubscriptionError(false);
    return subscribeInvite(inviteId, setInvite, (e) => { setError(inviteErrorMessage(e, locale)); setSubscriptionError(true); });
  }, [inviteId, retry, locale]);
  const now = useInviteClock([invite]);
  const state = invite ? inviteState(invite, now) : null;
  const valid = state === 'active' && !subscriptionError;
  const alreadyMember = invite ? context.projects.some((project) => project.id === invite.projectId) : false;
  const roleLabel = invite?.role === 'admin' ? pick(locale, 'ผู้ดูแล (Admin)', 'an Admin') : pick(locale, 'สมาชิก (Member)', 'a Member');
  const expiry = invite?.expiresAt?.toDate().toLocaleString(locale === 'th' ? 'th-TH' : 'en-US');

  const accept = async () => {
    if (!invite || accepting.current || !context.projectsLoaded) return;
    accepting.current = true; setBusy(true); setError('');
    const currentId = inviteId;
    try {
      const result = await acceptInvite(currentId, context.user);
      if (routeId.current === currentId) navigate(`/p/${result.projectId}/overview`);
    } catch (e) {
      if (routeId.current === currentId) setError(inviteErrorMessage(e, locale));
    } finally {
      if (routeId.current === currentId) { accepting.current = false; setBusy(false); }
    }
  };

  return (
    <>
      <AppHeader context={context} />
      <main className="center-content">
        <div className="invite-card">
          <div className="invite-icon"><Icon name="mail" /></div>
          {subscriptionError || (!online && invite === undefined) ? (
            <><p className="form-error">{online ? error : inviteErrorMessage({ code: 'unavailable' }, locale)}</p><button className="secondary wide" onClick={() => setRetry((value) => value + 1)}>{pick(locale, 'ลองใหม่', 'Retry')}</button></>
          ) : invite === undefined ? (
            <p>{context.t('loading')}</p>
          ) : !invite ? (
            <>
              <h1>{pick(locale, 'ไม่พบคำเชิญ', 'Invite not found')}</h1>
              <p>{pick(locale, 'ลิงก์นี้ไม่ถูกต้องหรือถูกลบแล้ว ขอลิงก์ใหม่จากเจ้าของโปรเจกต์', 'This link is invalid or was deleted. Ask the project owner for a new one.')}</p>
              <button className="secondary wide" onClick={() => navigate('/')}>{pick(locale, 'กลับหน้าแรก', 'Back to home')}</button>
            </>
          ) : (
            <>
              <span className="eyebrow">{pick(locale, 'คำเชิญเข้าร่วมโปรเจกต์', 'PROJECT INVITATION')}</span>
              <h1>{invite.projectName}</h1>
              <p>
                {invite.createdByName
                  ? pick(locale, `${invite.createdByName} ชวนคุณเข้าร่วมในฐานะ `, `${invite.createdByName} invited you to join as `)
                  : pick(locale, 'คุณได้รับเชิญให้เข้าร่วมในฐานะ ', 'You’re invited to join as ')}
                <b>{roleLabel}</b>
              </p>
              {valid && <p className="invite-meta"><Icon name="clock" /> {pick(locale, expiry ? `ลิงก์ใช้ได้ถึง ${expiry}` : 'ไม่มีวันหมดอายุ', expiry ? `Link valid until ${expiry}` : 'Never expires')}</p>}
              {!valid && !alreadyMember && (
                <p className="form-error">
                  {inviteErrorMessage(new Error(`INVITE_${state?.toUpperCase()}`), locale)}
                </p>
              )}
              {!online && <p className="form-error">{inviteErrorMessage({ code: 'unavailable' }, locale)}</p>}
              {error && <p className="form-error">{error}</p>}
              {!context.projectsLoaded ? <p>{context.t('loading')}</p> : alreadyMember ? (
                <>
                  <p className="invite-meta"><Icon name="check" /> {pick(locale, 'คุณเป็นสมาชิกโปรเจกต์นี้อยู่แล้ว', 'You’re already a member of this project')}</p>
                  <button className="primary wide" onClick={() => navigate(`/p/${invite.projectId}/overview`)}>
                    {pick(locale, 'เปิดโปรเจกต์', 'Open project')}
                  </button>
                </>
              ) : (
                <button className="primary wide" disabled={!valid || busy || !context.projectsLoaded || !online} onClick={accept}>
                  {busy ? pick(locale, 'กำลังเข้าร่วม…', 'Joining…') : pick(locale, 'เข้าร่วมโปรเจกต์', 'Join project')}
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
