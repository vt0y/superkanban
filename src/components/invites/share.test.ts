import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import { translate, type MessageKey } from '@/utils/i18n';
import { copyInviteLink } from './share';
import { toast } from '@/components/toast';
vi.mock('@/components/toast', () => ({ toast: vi.fn() }));
const context = { t: (key: MessageKey) => translate('en', key) } as AppContextValue;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('invitation link sharing', () => {
  it('copies the current-origin URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('location', { origin: 'https://example.com' });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyInviteLink('abc', context)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.com/invite/abc');
  });
  it('signals manual URL fallback when clipboard is absent or rejects', async () => {
    vi.stubGlobal('location', { origin: 'https://example.com' });
    for (const navigator of [{}, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } }]) {
      vi.stubGlobal('navigator', navigator);
      expect(await copyInviteLink('abc', context)).toBe(false);
      expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('manually'), 'error');
    }
  });
});
