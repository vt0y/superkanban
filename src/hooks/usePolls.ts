import { useEffect, useMemo, useRef, useState } from 'react';
import type { Poll, PollVote } from '@/types';
import { loadClosedPollsPage, subscribeOpenPolls, subscribeRecentClosedPolls, subscribeVotesForPolls, type CollectionCursor } from '@/services';

export function usePolls(projectId: string, detailedClosedIds: string[] = []) {
  const [open, setOpen] = useState<Poll[]>([]);
  const [closed, setClosed] = useState<Poll[]>([]);
  const [cursor, setCursor] = useState<CollectionCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const paged = useRef(false);
  const polls = useMemo(() => [...open, ...closed], [open, closed]);
  const detailKey = [...detailedClosedIds].sort().join(',');
  const pollKey = [...new Set([...open.map((poll) => poll.id), ...(detailKey ? detailKey.split(',') : [])])].sort().join(',');
  const [votes, setVotes] = useState<PollVote[]>([]);
  useEffect(() => {
    paged.current = false;
    const stopOpen = subscribeOpenPolls(projectId, setOpen);
    const stopClosed = subscribeRecentClosedPolls(projectId, (items) => {
      setClosed((current) => [...items, ...current.filter((poll) => !items.some((recent) => recent.id === poll.id))]);
      const last = items.at(-1);
      if (!paged.current) {
        setCursor(last?.updatedAt ? { value: last.updatedAt, id: last.id } : null);
        setHasMore(items.length === 50);
      }
    });
    return () => { stopOpen(); stopClosed(); };
  }, [projectId]);
  useEffect(() => subscribeVotesForPolls(projectId, pollKey ? pollKey.split(',') : [], setVotes), [projectId, pollKey]);
  const loadMore = async () => {
    if (!cursor || !hasMore || loadingMore) return;
    setLoadingMore(true);
    paged.current = true;
    try {
      const page = await loadClosedPollsPage(projectId, cursor, 50);
      setClosed((current) => [...current, ...page.items.filter((poll) => !current.some((existing) => existing.id === poll.id))]);
      setCursor(page.nextCursor); setHasMore(page.hasMore);
    } finally { setLoadingMore(false); }
  };
  return { polls, votes, hasMore, loadingMore, loadMore };
}
