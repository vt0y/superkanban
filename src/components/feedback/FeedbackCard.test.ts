import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import type { SiteFeedback } from '@/types';
import { toast } from '@/components/toast';
import { deleteSiteFeedback, updateSiteFeedback } from '@/services/feedback';
import { FeedbackCard } from './FeedbackCard';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'string' ? ' Answer ' : initial, vi.fn()],
  useEffect: vi.fn(), useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock('@/services/feedback', () => ({ updateSiteFeedback: vi.fn(), deleteSiteFeedback: vi.fn() }));
vi.mock('@/components/toast', () => ({ toast: vi.fn() }));
const context = { locale: 'en', user: { uid: 'staff' }, t: () => 'Delete' } as unknown as AppContextValue;
const item = { id: 'f1', title: 'Bug', category: 'bug', status: 'open', adminReply: '', userId: 'alice' } as SiteFeedback;
function propsFor(node: ReactNode, predicate: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => propsFor(child, predicate));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(predicate(node.type, node.props) ? [node.props] : []), ...propsFor(node.props.children, predicate)];
}
function replyButton(onChanged = vi.fn()) {
  const card = FeedbackCard({ item, admin: true, context, onChanged });
  return propsFor(card, (type, props) => type === 'button' && props.children === 'Save reply')[0].onClick as () => void;
}
beforeEach(() => vi.resetAllMocks());

describe('feedback triage writes', () => {
  it('saves a trimmed reply, shows success, and refreshes the summary only after success', async () => {
    const onChanged = vi.fn();
    vi.mocked(updateSiteFeedback).mockResolvedValue();
    replyButton(onChanged)();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(updateSiteFeedback).toHaveBeenCalledWith('f1', { adminReply: 'Answer' });
    expect(toast).toHaveBeenCalledWith('Reply saved', 'success');
  });
  it('reports failure without emitting success or refreshing the summary', async () => {
    vi.mocked(updateSiteFeedback).mockRejectedValue(new Error('Denied'));
    const onChanged = vi.fn();
    replyButton(onChanged)();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Update failed', 'error'));
    expect(toast).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('blocks duplicate writes while saving and enforces the reply input length', async () => {
    let finish!: () => void;
    vi.mocked(updateSiteFeedback).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const click = replyButton();
    click(); click();
    expect(updateSiteFeedback).toHaveBeenCalledOnce();
    finish();
    const card = FeedbackCard({ item, admin: true, context });
    expect(propsFor(card, (type) => type === 'textarea')[0].maxLength).toBe(3000);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Reply saved', 'success'));
  });
  it('confirms deletion and does not write when cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    try {
      const card = FeedbackCard({ item, admin: true, context });
      const click = propsFor(card, (type, props) => type === 'button' && props.title === 'Delete')[0].onClick as () => void;
      click();
      expect(deleteSiteFeedback).not.toHaveBeenCalled();
      vi.mocked(confirm).mockReturnValue(true);
      vi.mocked(deleteSiteFeedback).mockResolvedValue();
      click();
      await vi.waitFor(() => expect(deleteSiteFeedback).toHaveBeenCalledWith('f1'));
    } finally { vi.unstubAllGlobals(); }
  });
});
