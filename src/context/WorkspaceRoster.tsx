import { measuredFirestore } from '@/services/firestore-diagnostics';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { collection, doc, limit, query, where } from 'firebase/firestore';
import type { Membership } from '@/types';
import { database, withId } from '@/services/helpers';

const { onSnapshot } = measuredFirestore('roster');

interface RosterState { members: Membership[]; loaded: boolean; failed: boolean }
interface RosterContextValue {
  own: Membership | null; ownLoaded: boolean; ownFailed: boolean;
  preview: Membership[]; full: RosterState; demand: (delta: number) => void; retry: () => void;
}
const RosterContext = createContext<RosterContextValue | null>(null);
const empty: RosterState = { members: [], loaded: false, failed: false };

/** A keyed provider prevents cached access/rosters crossing projects or accounts. */
export function WorkspaceRosterProvider({ projectId, userId, children }: { projectId: string; userId: string; children: ReactNode }) {
  return <RosterSession key={`${projectId}:${userId}`} projectId={projectId} userId={userId}>{children}</RosterSession>;
}
function RosterSession({ projectId, userId, children }: { projectId: string; userId: string; children: ReactNode }) {
  const [own, setOwn] = useState<Membership | null>(null);
  const [ownLoaded, setOwnLoaded] = useState(false);
  const [ownFailed, setOwnFailed] = useState(false);
  const [preview, setPreview] = useState<Membership[]>([]);
  const [full, setFull] = useState<RosterState>(empty);
  const [requests, setRequests] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [demand] = useState(() => (delta: number) => setRequests((count) => Math.max(0, count + delta)));
  const [retry] = useState(() => () => setRetryCount((count) => count + 1));
  useEffect(() => {
    setOwnLoaded(false); setOwnFailed(false);
    return onSnapshot(doc(database(), 'memberships', `${projectId}_${userId}`), (snapshot) => {
      setOwn(snapshot.exists() ? withId<Membership>(snapshot) : null); setOwnLoaded(true);
    }, () => { setOwn(null); setOwnFailed(true); setOwnLoaded(true); });
  }, [projectId, userId, retryCount]);
  const allowed = ownLoaded && Boolean(own);
  const needsFull = requests > 0;
  useEffect(() => {
    setFull(empty);
    if (!allowed || !needsFull) return;
    return onSnapshot(query(collection(database(), 'memberships'), where('projectId', '==', projectId)), (snapshot) => {
      setFull({ members: snapshot.docs.map((item) => withId<Membership>(item)).sort((a, b) => a.displayName.localeCompare(b.displayName)), loaded: true, failed: false });
    }, () => setFull({ ...empty, failed: true }));
  }, [projectId, allowed, needsFull, retryCount]);
  useEffect(() => {
    setPreview([]);
    if (!allowed || needsFull) return;
    return onSnapshot(query(collection(database(), 'memberships'), where('projectId', '==', projectId), limit(5)), (snapshot) => setPreview(snapshot.docs.map((item) => withId<Membership>(item))));
  }, [projectId, allowed, needsFull]);
  return <RosterContext.Provider value={{ own, ownLoaded, ownFailed, preview: needsFull ? full.members.slice(0, 5) : preview, full: allowed && needsFull ? full : empty, demand, retry }}>{children}</RosterContext.Provider>;
}
export function useWorkspaceRoster() {
  const value = useContext(RosterContext);
  if (!value) throw new Error('WORKSPACE_ROSTER_REQUIRED');
  return value;
}
export function useFullProjectMembers(enabled = true): RosterState {
  const { full, demand } = useWorkspaceRoster();
  useEffect(() => { if (!enabled) return; demand(1); return () => demand(-1); }, [enabled, demand]);
  return enabled ? full : empty;
}
