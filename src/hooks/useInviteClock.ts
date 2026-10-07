import { useEffect, useState } from 'react';
import type { Invite } from '@/types';

/** Refresh at the next deadline, including when a sleeping tab becomes visible. */
export function useInviteClock(invites: (Invite | null | undefined)[]) {
  const [now, setNow] = useState(Date.now());
  const deadline = Math.min(...invites.flatMap((invite) => invite?.expiresAt ? [invite.expiresAt.toMillis()] : []).filter((time) => time > now));
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = Number.isFinite(deadline) ? window.setTimeout(refresh, Math.min(deadline - Date.now() + 20, 2147483647)) : undefined;
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [deadline, now]);
  return now;
}

