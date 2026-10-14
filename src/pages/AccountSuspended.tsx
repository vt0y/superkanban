import type { Locale } from '@/types';
import { Icon } from '@/components/common/Icon';
import { pick } from '@/utils/formatters';

export function AccountSuspended({ locale, onSignOut }: { locale: Locale; onSignOut: () => void }) {
  return (
    <main className="page-shell account-suspended">
      <section className="panel" aria-labelledby="suspended-title">
        <Icon name="lock" />
        <h1 id="suspended-title">{pick(locale, 'บัญชีถูกระงับการใช้งาน', 'Account suspended')}</h1>
        <p>{pick(locale, 'ผู้ดูแลเว็บระงับการใช้ SuperKanban ของบัญชีนี้ ข้อมูลของคุณยังคงอยู่ เมื่อผู้ดูแลเปิดใช้งานอีกครั้ง คุณจะกลับมาใช้งานได้', 'A site administrator has suspended this account in SuperKanban. Your data is preserved. Access will return when an administrator reactivates your account.')}</p>
        <button type="button" className="secondary" onClick={onSignOut}>{pick(locale, 'ออกจากระบบ', 'Sign out')}</button>
      </section>
    </main>
  );
}
