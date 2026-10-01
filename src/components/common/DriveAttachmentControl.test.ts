import { describe, expect, it, vi } from 'vitest';
import { beginOptimisticDetach, updateUploadQueueItem, uploadRetryAction } from './DriveAttachmentControl';

const deferred = () => {
  let resolve!: (value: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('optimistic Drive attachment detachment', () => {
  it('does not hide a row when confirmation is cancelled', () => {
    const setHidden = vi.fn();
    beginOptimisticDetach(() => false, setHidden);
    expect(setHidden).not.toHaveBeenCalled();
  });

  it('hides immediately and stays hidden after successful deletion', async () => {
    const pending = deferred();
    const setHidden = vi.fn();
    beginOptimisticDetach(() => pending.promise, setHidden);
    expect(setHidden).toHaveBeenCalledWith(true);
    pending.resolve(true);
    await pending.promise;
    expect(setHidden).toHaveBeenCalledTimes(1);
  });

  it('restores a row when deletion fails or rejects', async () => {
    const failed = deferred();
    const rejected = deferred();
    const setHidden = vi.fn();
    beginOptimisticDetach(() => failed.promise, setHidden);
    failed.resolve(false);
    await failed.promise;
    await Promise.resolve();
    expect(setHidden).toHaveBeenLastCalledWith(false);

    beginOptimisticDetach(() => rejected.promise, setHidden);
    rejected.reject(new Error('failed'));
    await rejected.promise.catch(() => undefined);
    await Promise.resolve();
    expect(setHidden).toHaveBeenLastCalledWith(false);
  });
});

describe('Drive upload queue helpers', () => {
  it('chooses retry from the last durable checkpoint', () => {
    const localFile = {} as File;
    expect(uploadRetryAction({ state: 'error', source: 'local', localFile, retryable: true })).toBe('restart-upload');
    expect(uploadRetryAction({ state: 'error', source: 'create', createType: 'document', retryable: true })).toBe('restart-upload');
    expect(uploadRetryAction({ state: 'error', source: 'local', localFile, candidate: { driveFileId: 'uploaded', name: 'plan.pdf', mimeType: 'application/pdf' }, retryable: true })).toBe('resume-attach');
    expect(uploadRetryAction({ state: 'error', source: 'drive', candidate: { driveFileId: 'picked', name: 'notes.md', mimeType: 'text/markdown' }, retryable: true })).toBe('resume-attach');
    expect(uploadRetryAction({ state: 'error', source: 'picker', retryable: true })).toBe('reopen-picker');
  });

  it('does not retry permanent or non-error states', () => {
    expect(uploadRetryAction({ state: 'error', source: 'local', localFile: {} as File, retryable: false })).toBeNull();
    expect(uploadRetryAction({ state: 'attached', source: 'drive', candidate: { driveFileId: 'done', name: 'done.pdf', mimeType: 'application/pdf' }, retryable: true })).toBeNull();
  });

  it('updates only the matching queue item', () => {
    const items = [{ key: 'one', state: 'queued' }, { key: 'two', state: 'queued' }];
    const updated = updateUploadQueueItem(items, 'two', { state: 'attached' });
    expect(updated).toEqual([{ key: 'one', state: 'queued' }, { key: 'two', state: 'attached' }]);
    expect(updated[0]).toBe(items[0]);
    expect(updated[1]).not.toBe(items[1]);
  });
});
