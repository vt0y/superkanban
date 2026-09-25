export type ToastKind = 'info' | 'success' | 'error';
export interface ToastItem { id: number; message: string; kind: ToastKind }
export const TOAST_EVENT = 'ps-toast';

export function toast(message: string, kind: ToastKind = 'info'): void {
  dispatchEvent(new CustomEvent<Omit<ToastItem, 'id'>>(TOAST_EVENT, { detail: { message, kind } }));
}

/** Runs a Firestore write and turns failures into an error toast instead of an unhandled rejection. */
export async function attempt<T>(work: () => Promise<T>, errorMessage: string): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    console.error(error);
    toast(errorMessage, 'error');
    return undefined;
  }
}
