import type { Locale } from '@/types';
import { pick } from './formatters';

export interface AdminLoadError { code: string }
/** Keep the useful error code without exposing profiles, query values or SDK messages. */
export function adminLoadError(cause: unknown): AdminLoadError {
  const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code.replace(/^firestore\//, '') : 'unknown';
  return { code };
}
export function adminLoadErrorMessage(error: AdminLoadError, locale: Locale): string {
  switch (error.code) {
    case 'permission-denied': return pick(locale, 'ไม่มีสิทธิ์โหลดข้อมูลส่วนนี้ กรุณาตรวจสอบสิทธิ์ผู้ดูแลและการเผยแพร่กฎ Firestore (permission-denied)', 'Access denied. Check your site role and deployed Firestore rules (permission-denied).');
    case 'unauthenticated': return pick(locale, 'เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ (unauthenticated)', 'Your session expired. Sign out and sign in again (unauthenticated).');
    case 'unavailable':
    case 'deadline-exceeded': return pick(locale, 'เชื่อมต่อข้อมูลไม่ได้ชั่วคราว กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'Could not connect temporarily. Check your connection and retry.');
    case 'resource-exhausted': return pick(locale, 'บริการข้อมูลใช้งานถึงขีดจำกัดแล้ว กรุณาลองใหม่ภายหลัง (resource-exhausted)', 'The data service has reached its limit. Try again later (resource-exhausted).');
    default: return pick(locale, 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่', 'Could not load records. Please retry.');
  }
}
