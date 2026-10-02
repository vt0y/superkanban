import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { acceptInvite, subscribeInvite } from '@/services/invites';
import type { Invite } from '@/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { Icon } from '@/components/common/Icon';

export function InviteAccept({ context }: { context: AppContextValue }) {
  const { inviteId = '' } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeInvite(inviteId, setInvite), [inviteId]);
  const valid = invite?.status === 'active' && invite.expiresAt.toMillis() > Date.now();
  const alreadyMember = invite ? context.projects.some((project) => project.id === invite.projectId) : false;

  const accept = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      await acceptInvite(invite, context.user);
      navigate(`/p/${invite.projectId}/dashboard`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
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
              <h1>ไม่พบคำเชิญ</h1>
              <p>ลิงก์นี้ไม่ถูกต้องหรือถูกลบแล้ว</p>
            </>
          ) : (
            <>
              <span className="eyebrow">PROJECT INVITATION</span>
              <h1>{invite.projectName}</h1>
              <p>
                คุณได้รับเชิญเป็น <b>{invite.role}</b>
              </p>
              {!valid && <p className="form-error">คำเชิญหมดอายุหรือถูกยกเลิกแล้ว</p>}
              {error && <p className="form-error">{error}</p>}
              {alreadyMember ? (
                <button className="primary wide" onClick={() => navigate(`/p/${invite.projectId}/dashboard`)}>
                  เปิดโปรเจกต์
                </button>
              ) : (
                <button className="primary wide" disabled={!valid || busy} onClick={accept}>
                  {busy ? 'กำลังเข้าร่วม...' : 'เข้าร่วมโปรเจกต์'}
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
