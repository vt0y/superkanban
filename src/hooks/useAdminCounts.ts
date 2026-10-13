import { useCallback, useEffect, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { loadAdminOverview, type AdminOverviewCounts } from '@/services/admin';
import { loadSiteFeedbackCounts, type FeedbackCounts } from '@/services/feedback';
import { adminLoadError, adminLoadErrorMessage } from '@/utils/admin-errors';

/** Site-wide counts shared by the admin nav badges, overview, and feedback filters. Each source fails independently. */
export function useAdminCounts(context: AppContextValue) {
  const { locale } = context;
  const [overview, setOverview] = useState<AdminOverviewCounts | null>(null);
  const [feedback, setFeedback] = useState<FeedbackCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    void Promise.allSettled([loadAdminOverview(), loadSiteFeedbackCounts()]).then(([site, inbox]) => {
      if (!current) return;
      setOverview(site.status === 'fulfilled' ? site.value : null);
      setFeedback(inbox.status === 'fulfilled' ? inbox.value : null);
      const failed = site.status === 'rejected' ? site.reason : inbox.status === 'rejected' ? inbox.reason : null;
      setError(failed === null ? null : adminLoadErrorMessage(adminLoadError(failed), locale));
      setLoading(false);
    });
    return () => { current = false; };
  }, [context.user.uid, locale, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { overview, feedback, loading, error, refresh };
}
