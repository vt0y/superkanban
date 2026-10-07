import type { Locale } from '@/types';
import { pick } from './formatters';

/** A message an invitee can act on, for an error thrown while accepting an invite. */
export function inviteErrorMessage(error: unknown, locale: Locale): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : '';
  if (message === 'INVITE_NOT_FOUND') return pick(locale, 'ไม่พบคำเชิญนี้ ลิงก์อาจถูกลบไปแล้ว', 'This invite no longer exists. The link may have been deleted.');
  if (message === 'INVITE_REVOKED') return pick(locale, 'คำเชิญนี้ถูกยกเลิกแล้ว ขอลิงก์ใหม่จากเจ้าของโปรเจกต์', 'This invite was revoked. Ask the project owner for a new link.');
  if (message === 'INVITE_PAUSED') return pick(locale, 'คำเชิญนี้พักใช้งานอยู่ กรุณาติดต่อผู้ดูแลโปรเจกต์', 'This invite is paused. Contact the project administrator.');
  if (message === 'INVITE_EXPIRED') return pick(locale, 'คำเชิญนี้หมดอายุแล้ว ขอลิงก์ใหม่หรือให้ผู้ดูแลขยายเวลา', 'This invite expired. Ask for a new link or an extension.');
  if (message === 'INVITE_EXHAUSTED') return pick(locale, 'คำเชิญนี้ใช้ครบจำนวนแล้ว ขอลิงก์ใหม่จากผู้ดูแล', 'This invite has reached its usage limit. Ask the administrator for a new link.');
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return pick(
      locale,
      'เข้าร่วมไม่ได้: คำเชิญอาจหมดอายุ หรือโปรเจกต์ถูกเก็บไปแล้ว ลองขอลิงก์ใหม่จากเจ้าของโปรเจกต์',
      'Couldn’t join: the invite may have expired or the project was archived. Ask the project owner for a new link.',
    );
  }
  if (code === 'unavailable' || code === 'firestore/unavailable') return pick(locale, 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'You seem to be offline. Check your connection and try again.');
  return pick(locale, 'เข้าร่วมโปรเจกต์ไม่สำเร็จ กรุณาลองใหม่', 'Couldn’t join the project. Please try again.');
}
