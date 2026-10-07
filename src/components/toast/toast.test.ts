import { afterEach, describe, expect, it, vi } from 'vitest';
import { attempt, TOAST_EVENT } from './toast';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('retryable error notifications', () => {
  it('preserves a cleanup retry after a failed write', async () => {
    const dispatch = vi.fn();
    vi.stubGlobal('dispatchEvent', dispatch);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn(async () => undefined);
    const error = Object.assign(new Error('cleanup failed'), { retry });
    expect(await attempt(async () => { throw error; }, 'Could not remove documents')).toBeUndefined();
    const event = dispatch.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe(TOAST_EVENT);
    expect(event.detail).toMatchObject({ kind: 'error', retry });
    expect(event.detail.message).toContain('Canvas cleanup');
    await event.detail.retry();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps ordinary errors transient and returns successful results unchanged', async () => {
    const dispatch = vi.fn();
    vi.stubGlobal('dispatchEvent', dispatch);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await attempt(async () => 42, 'Failed')).toBe(42);
    expect(dispatch).not.toHaveBeenCalled();
    await attempt(async () => { throw new Error('write failed'); }, 'Failed');
    expect((dispatch.mock.calls[0][0] as CustomEvent).detail).toEqual({ message: 'Failed', kind: 'error', retry: undefined });
  });
});
