import * as firestore from 'firebase/firestore';

type Metric = 'listener-created' | 'listener-reused' | 'server-documents' | 'explicit-read' | 'transaction-attempt' | 'write-command';
const counts: Record<string, number> = {};
const enabled = import.meta.env.DEV && import.meta.env.VITE_FIRESTORE_DIAGNOSTICS === 'true';
/** Development-only client operations, never billing estimates or telemetry. No paths/data/UIDs. */
export function recordFirestoreOperation(workflow: string, metric: Metric, count = 1) {
  if (!enabled) return;
  const key = `${workflow}:${metric}`;
  counts[key] = (counts[key] || 0) + count;
}
export function firestoreDiagnosticCounts() { return { ...counts }; }
export function resetFirestoreDiagnosticCounts() { for (const key of Object.keys(counts)) delete counts[key]; }
if (enabled) Object.assign(globalThis, { firestoreDiagnostics: { counts: firestoreDiagnosticCounts, reset: resetFirestoreDiagnosticCounts } });

/** Preserve SDK overloads and generic return types while measuring the operations at their boundary. */
export function measuredFirestore(workflow: string) {
  const record = (metric: Metric, count = 1) => recordFirestoreOperation(workflow, metric, count);
  const documents = (snapshot: any, changesOnly = false) => {
    if (!snapshot?.metadata || snapshot.metadata.fromCache) return;
    const count = snapshot.docs ? changesOnly ? snapshot.docChanges().filter((change: any) => change.type !== 'removed').length : snapshot.docs.length : snapshot.exists() ? 1 : 0;
    record('server-documents', count);
  };
  const read = <F extends (...args: any[]) => any>(operation: F): F => ((...args: Parameters<F>) => {
    record('explicit-read');
    return operation(...args).then((snapshot: any) => { documents(snapshot); return snapshot; });
  }) as F;
  const instrumentWrites = <T extends firestore.Transaction | firestore.WriteBatch>(target: T): T => {
    if (!enabled) return target;
    const proxy = new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property, object);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (['set', 'update', 'delete'].includes(String(property))) record('write-command');
          if (property === 'get') record('explicit-read');
          const result = value.apply(object, args);
          if (property === 'get') return result.then((snapshot: any) => { documents(snapshot); return snapshot; });
          return result === object ? proxy : result;
        };
      },
    });
    return proxy;
  };
  const write = <F extends (...args: any[]) => any>(operation: F): F => ((...args: Parameters<F>) => { record('write-command'); return operation(...args); }) as F;
  return {
    updateDoc: write(((...args: any[]) => (firestore.updateDoc as any)(...args)) as typeof firestore.updateDoc),
    deleteDoc: write(((...args: any[]) => (firestore.deleteDoc as any)(...args)) as typeof firestore.deleteDoc),
    getDocsFromServer: read(((...args: any[]) => (firestore.getDocsFromServer as any)(...args)) as typeof firestore.getDocsFromServer),
    getDoc: read(((...args: any[]) => (firestore.getDoc as any)(...args)) as typeof firestore.getDoc),
    getDocs: read(((...args: any[]) => (firestore.getDocs as any)(...args)) as typeof firestore.getDocs),
    getCountFromServer: read(((...args: any[]) => (firestore.getCountFromServer as any)(...args)) as typeof firestore.getCountFromServer),
    runTransaction: ((store, callback, options) => firestore.runTransaction(store, (transaction) => {
      record('transaction-attempt'); return callback(instrumentWrites(transaction));
    }, options)) as typeof firestore.runTransaction,
    writeBatch: ((store) => instrumentWrites(firestore.writeBatch(store))) as typeof firestore.writeBatch,
    onSnapshot: ((...args: any[]) => {
      record('listener-created');
      // These services use callback overloads; also support observer/options overloads.
      const snapshotIndex = args.findIndex((value, index) => index > 0 && (typeof value === 'function' || value && typeof value.next === 'function'));
      const callback = args[snapshotIndex];
      const deliver = (snapshot: any) => {
        documents(snapshot, true);
        if (typeof callback === 'function') callback(snapshot); else callback.next(snapshot);
      };
      if (snapshotIndex >= 0) args[snapshotIndex] = typeof callback === 'function' ? deliver : { ...callback, next: deliver };
      return (firestore.onSnapshot as (...values: any[]) => firestore.Unsubscribe)(...args);
    }) as typeof firestore.onSnapshot,
  };
}
