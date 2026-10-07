export type ToastKind = 'info' | 'success' | 'error';
export interface ToastItem { id: number; message: string; kind: ToastKind; retry?: () => Promise<void> }
export const TOAST_EVENT = 'ps-toast';

export function toast(message: string, kind: ToastKind = 'info', retry?: () => Promise<void>): void {
  dispatchEvent(new CustomEvent<Omit<ToastItem, 'id'>>(TOAST_EVENT, { detail: { message, kind, retry } }));
}

/** Runs a Firestore write and turns failures into an error toast instead of an unhandled rejection. */
export async function attempt<T>(work: () => Promise<T>, errorMessage: string): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    console.error(error);
    const retry = error instanceof Error && 'retry' in error && typeof error.retry === 'function' ? error.retry as () => Promise<void> : undefined;
    toast(retry ? `${errorMessage} · Canvas cleanup / ล้างการ์ดบนกระดาน` : errorMessage, 'error', retry);
    return undefined;
  }
}
