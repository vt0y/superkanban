import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { acceptInvite, subscribeInvite } from '@/services/invites';
import type { Invite } from '@/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { Icon } from '@/components/common/Icon';
import { pick } from '@/utils/formatters';
import { inviteErrorMessage } from '@/utils/invite-errors';

export function InviteAccept({ context }: { context: AppContextValue }) {
  const { inviteId = '' } = useParams();
  const navigate = useNavigate();
  const { locale } = context;
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeInvite(inviteId, setInvite), [inviteId]);
  const expired = invite ? invite.expiresAt.toMillis() <= Date.now() : false;
  const valid = invite?.status === 'active' && !expired;
  const alreadyMember = invite ? context.projects.some((project) => project.id === invite.projectId) : false;
  const roleLabel = invite?.role === 'admin' ? pick(locale, 'ผู้ดูแล (Admin)', 'an Admin') : pick(locale, 'สมาชิก (Member)', 'a Member');
  const expiry = invite?.expiresAt.toDate().toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  const accept = async () => {
    if (!invite) return;
    setBusy(true);
    setError('');
    try {
      await acceptInvite(invite, context.user);
      navigate(`/p/${invite.projectId}/overview`);
    } catch (e) {
      console.error(e);
      setError(inviteErrorMessage(e, locale));
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader context={context} />
      <main className="center-content">
        <div className="invite-card">
          <div className="invite-icon"><Icon name="mail" /></div>
          {invite === undefined ? (
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
              {valid && expiry && <p className="invite-meta"><Icon name="clock" /> {pick(locale, `ลิงก์ใช้ได้ถึง ${expiry}`, `Link valid until ${expiry}`)}</p>}
              {!valid && !alreadyMember && (
                <p className="form-error">
                  {invite.status === 'revoked'
                    ? pick(locale, 'คำเชิญนี้ถูกยกเลิกแล้ว ขอลิงก์ใหม่จากเจ้าของโปรเจกต์', 'This invite was revoked. Ask the project owner for a new link.')
                    : pick(locale, `คำเชิญนี้หมดอายุเมื่อ ${expiry} ขอลิงก์ใหม่จากเจ้าของโปรเจกต์`, `This invite expired on ${expiry}. Ask the project owner for a new link.`)}
                </p>
              )}
              {error && <p className="form-error">{error}</p>}
              {alreadyMember ? (
                <>
                  <p className="invite-meta"><Icon name="check" /> {pick(locale, 'คุณเป็นสมาชิกโปรเจกต์นี้อยู่แล้ว', 'You’re already a member of this project')}</p>
                  <button className="primary wide" onClick={() => navigate(`/p/${invite.projectId}/overview`)}>
                    {pick(locale, 'เปิดโปรเจกต์', 'Open project')}
                  </button>
                </>
              ) : (
                <button className="primary wide" disabled={!valid || busy} onClick={accept}>
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
