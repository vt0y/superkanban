import { useEffect, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { toast } from '@/components/toast';
import {
  endGitHubSession,
  getGitHubSession,
  GitHubAuthError,
  linkGitHubAccount,
  onGitHubSessionChange,
  type GitHubSession,
} from '@/services/github';
import { fillMessage, type MessageKey } from '@/utils/i18n';
import { Icon } from '@/components/common/Icon';

/** The current management session; re-renders when it starts, ends, or expires. */
export function useGitHubSession(): GitHubSession | null {
  const [session, setSession] = useState(() => getGitHubSession());
  useEffect(() => {
    const refresh = () => setSession(getGitHubSession());
    const stop = onGitHubSessionChange(refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, []);
  return session;
}

/** Friendly message for a failed GitHub popup; null when the user simply closed it. */
export function gitHubPopupErrorKey(err: unknown): MessageKey | null {
  const code = (err as { code?: string }).code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/credential-already-in-use') return 'ghAccountInUse';
  if (code === 'auth/user-mismatch') return 'ghUserMismatch';
  return 'ghAuthFailed';
}

/** Like `attempt`, but an expired session ends sudo mode and says so instead of a generic error. */
export async function attemptGitHub<T>(context: AppContextValue, work: () => Promise<T>, errorKey: MessageKey): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    console.error(error);
    if (error instanceof GitHubAuthError) {
      endGitHubSession();
      toast(context.t('ghSessionExpired'), 'error');
    } else {
      toast(context.t(errorKey), 'error');
    }
    return undefined;
  }
}

export async function enterGitHubSession(context: AppContextValue): Promise<boolean> {
  try {
    await linkGitHubAccount(context.user, true);
    toast(context.t('ghSessionStarted'), 'success');
    return true;
  } catch (err) {
    const key = gitHubPopupErrorKey(err);
    if (key) toast(context.t(key), 'error');
    return false;
  }
}

export function GitHubSessionBar({ context, disabled = false }: { context: AppContextValue; disabled?: boolean }) {
  const { t } = context;
  const session = useGitHubSession();
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    setBusy(true);
    await enterGitHubSession(context);
    setBusy(false);
  };

  if (!session) {
    return (
      <div className="gh-session-bar off">
        <span>
          <Icon name="lock" /> <strong>{t('ghSessionOff')}</strong>
          <small>{t('ghSessionOffHint')}</small>
        </span>
        <button type="button" className="primary small" disabled={busy || disabled} onClick={() => void enter()}>
          {busy ? t('ghConnecting') : t('ghSessionEnter')}
        </button>
      </div>
    );
  }

  const minutesLeft = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 60_000));
  const remaining = fillMessage(t('ghSessionRemaining'), {
    h: String(Math.floor(minutesLeft / 60)),
    m: String(minutesLeft % 60),
  });

  return (
    <div className="gh-session-bar on">
      <span>
        <Icon name="unlock" /> <strong>{t('ghSessionOn')}</strong>
        <small>{remaining}</small>
      </span>
      <button
        type="button"
        className="secondary small"
        onClick={() => {
          endGitHubSession();
          toast(t('ghSessionEnded'));
        }}
      >
        {t('ghSessionExit')}
      </button>
    </div>
  );
}
