import { afterEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => {
  const transaction = { get: vi.fn(async () => ({ metadata: { fromCache: false }, exists: () => true })), update: vi.fn(), set: vi.fn(), delete: vi.fn() };
  return { transaction, callback: null as ((snapshot: any) => void) | null, writes: vi.fn(), batch: { set() { return this; }, update() { return this; }, commit: vi.fn() } };
});
vi.mock('firebase/firestore', () => ({
  onSnapshot: (_ref: unknown, callback: (snapshot: unknown) => void) => { sdk.callback = callback; return vi.fn(); },
  runTransaction: async (_db: unknown, callback: (transaction: unknown) => unknown) => callback(sdk.transaction),
  getDocs: async () => ({ metadata: { fromCache: false }, docs: [{}, {}] }),
  writeBatch: () => sdk.batch,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('Firestore development diagnostics', () => {
  it('stays disabled by default', async () => {
    vi.stubEnv('VITE_FIRESTORE_DIAGNOSTICS', 'false');
    const diagnostics = await import('./firestore-diagnostics');
    diagnostics.recordFirestoreOperation('workflow', 'explicit-read', 20);
    expect(diagnostics.firestoreDiagnosticCounts()).toEqual({});
  });

  it('counts server deliveries and transaction commands without recording paths or contents', async () => {
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_FIRESTORE_DIAGNOSTICS', 'true');
    const diagnostics = await import('./firestore-diagnostics');
    const operations = diagnostics.measuredFirestore('workflow');
    operations.onSnapshot('personal-id' as any, () => undefined);
    sdk.callback!({ metadata: { fromCache: true }, docs: [{}], docChanges: () => [{ type: 'added', doc: { secret: 'contents' } }] });
    sdk.callback!({ metadata: { fromCache: false }, docs: [{}], docChanges: () => [{ type: 'added', doc: { secret: 'contents' } }] });
    await operations.getDocs('private-path' as any);
    await operations.runTransaction('db' as any, async (transaction) => {
      await transaction.get('personal-id' as any); transaction.update('personal-id' as any, { private: 'contents' });
    });
    operations.writeBatch('db' as any).set('private' as any, {}).update('private' as any, {});
    expect(diagnostics.firestoreDiagnosticCounts()).toEqual({
      'workflow:listener-created': 1, 'workflow:server-documents': 4, 'workflow:explicit-read': 2,
      'workflow:transaction-attempt': 1, 'workflow:write-command': 3,
    });
    diagnostics.resetFirestoreDiagnosticCounts(); expect(diagnostics.firestoreDiagnosticCounts()).toEqual({});
  });
});
