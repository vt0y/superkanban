import { useCallback, useEffect, useRef, useState } from 'react';
import type { Invite } from '@/types';
import { setInviteStatus, subscribeProjectInvites } from '@/services/invites';

export function useProjectInvites(projectId: string) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; success: boolean } | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setInvites([]);
    setLoading(true);
    setFailed(false);
    setBusy(null);
    setFeedback(null);
    pending.current = false;
    const unsubscribe = subscribeProjectInvites(projectId, (items) => {
      if (generation.current !== current) return;
      setInvites(items);
      setLoading(false);
      setFailed(false);
    }, () => {
      if (generation.current !== current) return;
      setLoading(false);
      setFailed(true);
    });
    return () => { generation.current++; unsubscribe(); };
  }, [projectId, retry]);

  const changeStatus = useCallback(async (id: string, status: Invite['status']) => {
    if (pending.current) return;
    const current = generation.current;
    pending.current = true;
    setBusy(id);
    setFeedback(null);
    try {
      await setInviteStatus(id, status);
      if (generation.current === current) setFeedback({ id, success: true });
    } catch {
      if (generation.current === current) setFeedback({ id, success: false });
    } finally {
      if (generation.current === current) {
        pending.current = false;
        setBusy(null);
      }
    }
  }, []);
  return {
    invites, loading, failed, busy, feedback, changeStatus,
    clearFeedback: () => setFeedback(null),
    retry: () => setRetry((value) => value + 1),
  };
}
