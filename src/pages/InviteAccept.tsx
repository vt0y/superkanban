import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { acceptInvite, subscribeInvite } from '@/services/invites';
import type { Invite } from '@/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { InviteAcceptCard, type InviteReadFailure } from '@/components/invites/InviteAcceptCard';
import { useInviteClock } from '@/hooks/useInviteClock';
import { inviteState } from '@/utils/invite-state';
import { inviteErrorMessage, isUnavailableInviteError } from '@/utils/invite-errors';

export function InviteAccept({ context }: { context: AppContextValue }) {
  const { inviteId = '' } = useParams();
  return <InviteAcceptPage key={`${context.user.uid}:${inviteId}`} inviteId={inviteId} context={context} />;
}

function InviteAcceptPage({ context, inviteId }: { context: AppContextValue; inviteId: string }) {
  const navigate = useNavigate();
  const { locale } = context;
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [retry, setRetry] = useState(0);
  const [failure, setFailure] = useState<InviteReadFailure>(null);
  const [acceptUnavailable, setAcceptUnavailable] = useState(false);
  const accepting = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) setRetry((value) => value + 1);
    };
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, []);

  useEffect(() => {
    let current = true;
    setInvite(undefined); setError(''); setFailure(null); setAcceptUnavailable(false);
    const unsubscribe = subscribeInvite(inviteId, (item) => {
      if (!current) return;
      setInvite(item); setFailure(null); setAcceptUnavailable(false); setError('');
    }, (err) => {
      if (!current) return;
      // Discard any previously authorized preview when the server denies the read.
      setInvite(undefined);
      setFailure(isUnavailableInviteError(err) ? 'denied' : 'retryable');
      setError(inviteErrorMessage(err, locale));
    });
    return () => { current = false; unsubscribe(); };
  }, [inviteId, retry, locale]);

  const now = useInviteClock([invite]);
  const alreadyMember = invite ? context.projects.some((project) => project.id === invite.projectId) : false;
  const accept = async () => {
    if (!invite || accepting.current || !context.projectsLoaded || !online || failure || inviteState(invite, now) !== 'active') return;
    accepting.current = true; setBusy(true); setError('');
    try {
      const result = await acceptInvite(inviteId, context.user);
      if (alive.current) navigate(`/p/${result.projectId}/overview`);
    } catch (err) {
      if (alive.current) {
        setAcceptUnavailable(isUnavailableInviteError(err));
        setError(inviteErrorMessage(err, locale));
      }
    } finally {
      accepting.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return <>
    <AppHeader context={context} />
    <main className="center-content">
      <InviteAcceptCard invite={invite} locale={locale} projectsLoaded={context.projectsLoaded}
        alreadyMember={alreadyMember} now={now} online={online} busy={busy} failure={failure}
        acceptUnavailable={acceptUnavailable} error={error} onRetry={() => setRetry((value) => value + 1)}
        onHome={() => navigate('/')} onOpenProject={() => invite && navigate(`/p/${invite.projectId}/overview`)}
        onAccept={() => void accept()} />
    </main>
  </>;
}
