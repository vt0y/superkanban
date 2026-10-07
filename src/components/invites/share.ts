import type { AppContextValue } from '@/context/AppContext';
import { toast } from '@/components/toast';
export const inviteUrl = (id: string) => `${location.origin}/invite/${id}`;
export async function copyInviteLink(id: string, context: AppContextValue): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteUrl(id));
    toast(context.t('inviteCopied'));
    return true;
  } catch {
    toast(context.t('inviteCopyError'), 'error');
    return false;
  }
}
