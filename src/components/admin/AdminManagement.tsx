import { useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { loadAdminProjects, loadAdminUsers, setAdminAccountStatus, setAdminProjectArchived, type AdminProject, type AdminUser } from '@/services/admin';
import { useAdminCollection } from '@/hooks/useAdminCollection';
import { Empty } from '@/components/common/Empty';
import { Icon } from '@/components/common/Icon';
import { toast } from '@/components/toast';
import { adminLoadErrorMessage } from '@/utils/admin-errors';
import { pick } from '@/utils/formatters';

type Entry = AdminUser | AdminProject;
const loaders = { users: loadAdminUsers, projects: loadAdminProjects };
function isUser(entry: Entry): entry is AdminUser { return entry.kind === 'user'; }

export function AdminManagement({ context, kind }: { context: AppContextValue; kind: 'users' | 'projects' }) {
  const { locale } = context;
  const { items, hasMore, loading, loadingMore, error, refresh, retry, loadMore, replace } = useAdminCollection<Entry>(loaders[kind], context.user.uid);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [saving, setSaving] = useState<string[]>([]);
  const busy = useRef(new Set<string>());
  const users = kind === 'users';
  const stateOf = (entry: Entry) => isUser(entry) ? entry.accountStatus ?? 'active' : entry.archived ? 'archived' : 'active';
  const stateLabel = (state: string) => state === 'suspended' ? pick(locale, 'ถูกระงับ', 'Suspended') : state === 'archived' ? pick(locale, 'เก็บถาวร', 'Archived') : pick(locale, 'ใช้งาน', 'Active');
  const actionLabel = (entry: Entry) => isUser(entry)
    ? entry.accountStatus === 'suspended' ? pick(locale, 'เปิดใช้งาน', 'Reactivate') : pick(locale, 'ระงับผู้ใช้', 'Suspend user')
    : entry.archived ? pick(locale, 'กู้คืนโปรเจกต์', 'Restore project') : pick(locale, 'เก็บถาวร', 'Archive');
  const protectedUser = (entry: Entry) => isUser(entry) && (entry.id === context.user.uid || entry.siteRole !== null);
  const needle = search.trim().toLocaleLowerCase();
  const visible = items.filter((entry) => {
    const text = isUser(entry) ? `${entry.displayName} ${entry.email} ${entry.id}` : `${entry.name} ${entry.ownerName} ${entry.ownerEmail} ${entry.ownerId} ${entry.id}`;
    return (status === 'all' || stateOf(entry) === status) && text.toLocaleLowerCase().includes(needle);
  });
  const change = async (entry: Entry) => {
    if (busy.current.has(entry.id) || protectedUser(entry)) return;
    const name = isUser(entry) ? entry.displayName || entry.email || entry.id : entry.name || entry.id;
    if (!confirm(`${actionLabel(entry)}: ${name}?`)) return;
    busy.current.add(entry.id); setSaving([...busy.current]);
    try {
      if (isUser(entry)) {
        const next = entry.accountStatus === 'suspended' ? 'active' : 'suspended';
        await setAdminAccountStatus(entry.id, next, context.user.uid);
        replace(entry.id, { accountStatus: next });
      } else {
        await setAdminProjectArchived(entry.id, !entry.archived);
        replace(entry.id, { archived: !entry.archived });
      }
      toast(pick(locale, 'อัปเดตสถานะแล้ว', 'Status updated'), 'success');
    } catch {
      toast(pick(locale, 'อัปเดตไม่สำเร็จ กรุณารีเฟรชและลองใหม่', 'Update failed. Refresh and retry.'), 'error');
    } finally { busy.current.delete(entry.id); setSaving([...busy.current]); }
  };
  return (
    <section className="admin-management" aria-labelledby="management-title" aria-busy={loading || loadingMore}>
      <header className="page-title">
        <div>
          <h2 id="management-title">{users ? pick(locale, 'จัดการผู้ใช้', 'User management') : pick(locale, 'จัดการโปรเจกต์', 'Project management')}</h2>
          <p>{users ? pick(locale, 'ระงับหรือเปิดใช้งานบัญชีทั่วไป โดยเก็บข้อมูลเดิมไว้', 'Suspend or reactivate ordinary accounts while preserving their data.') : pick(locale, 'ดูโปรเจกต์ทั้งระบบ พร้อมเก็บถาวรและกู้คืน', 'View projects across the site, archive them, or restore them.')}</p>
        </div>
        <button type="button" className="secondary" disabled={loading || loadingMore || saving.length > 0} onClick={refresh}><Icon name="refresh" />{pick(locale, 'รีเฟรช', 'Refresh')}</button>
      </header>
      <div className="list-toolbar wrap admin-filters">
        <label className="admin-search"><Icon name="search" /><input type="search" aria-label={users ? pick(locale, 'ค้นหาผู้ใช้', 'Search users') : pick(locale, 'ค้นหาโปรเจกต์', 'Search projects')} placeholder={users ? pick(locale, 'ชื่อ อีเมล หรือ UID', 'Name, email, or UID') : pick(locale, 'ชื่อโปรเจกต์หรือเจ้าของ', 'Project or owner')} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select value={status} aria-label={pick(locale, 'สถานะ', 'Status')} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">{pick(locale, 'ทุกสถานะ', 'All statuses')}</option>
          <option value="active">{stateLabel('active')}</option>
          <option value={users ? 'suspended' : 'archived'}>{stateLabel(users ? 'suspended' : 'archived')}</option>
        </select>
      </div>
      <p className="muted admin-count-note">{pick(locale, `โหลดแล้ว ${items.length} รายการ · การค้นหาและตัวกรองใช้กับรายการที่โหลดแล้ว`, `${items.length} loaded · Search and filters apply to loaded records.`)}</p>
      {users && <p className="muted admin-count-note">{pick(locale, 'บัญชีผู้ดูแลเว็บได้รับการป้องกันจากการระงับ', 'Site staff accounts are protected from suspension.')}</p>}
      {error && <div className="admin-error" role="alert"><span>{adminLoadErrorMessage(error, locale)}</span><button type="button" className="secondary small" disabled={loadingMore || saving.length > 0} onClick={retry}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
      {loading && <p role="status">{pick(locale, 'กำลังโหลด…', 'Loading…')}</p>}
      <div className="admin-record-list">
        {visible.map((entry) => <article className="admin-record panel" key={entry.id}>
          <div className="admin-record-detail">
            <div className="admin-record-heading"><h3>{isUser(entry) ? entry.displayName || entry.email || entry.id : entry.name || entry.id}</h3><span className={`chip ${stateOf(entry) === 'active' ? 'admin-active' : 'admin-inactive'}`}>{stateLabel(stateOf(entry))}</span>{isUser(entry) && entry.siteRole && <span className="chip">{entry.siteRole}</span>}</div>
            {isUser(entry) ? <p>{entry.email}</p> : <><p>{pick(locale, 'เจ้าของ', 'Owner')}: {entry.ownerName}{entry.ownerEmail && ` · ${entry.ownerEmail}`}</p><p>{pick(locale, 'สมาชิก', 'Members')}: {entry.memberIds.length}</p></>}
            <small className="muted">{isUser(entry) ? 'UID' : pick(locale, 'รหัสโปรเจกต์', 'Project ID')}: <code>{entry.id}</code></small>
            {isUser(entry) && <small className="muted">{pick(locale, 'สร้างเมื่อ', 'Created')}: {entry.createdAt ? entry.createdAt.toDate().toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US') : '—'}</small>}
          </div>
          <button type="button" className={stateOf(entry) === 'active' ? 'danger ghost small' : 'secondary small'} disabled={saving.includes(entry.id) || protectedUser(entry)} onClick={() => void change(entry)}>
            {saving.includes(entry.id) ? pick(locale, 'กำลังบันทึก…', 'Saving…') : protectedUser(entry) ? pick(locale, 'บัญชีที่ได้รับการป้องกัน', 'Protected account') : actionLabel(entry)}
          </button>
        </article>)}
      </div>
      {!loading && !error && !visible.length && <Empty icon={users ? 'team' : 'folder'} title={pick(locale, 'ไม่พบรายการ', 'No matching records')} description={pick(locale, 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง หรือโหลดเพิ่มเติม', 'Try another search or filter, or load more.')} />}
      {hasMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingMore || saving.length > 0 || !!error} onClick={() => void loadMore()}>{loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดเพิ่มเติม', 'Load more')}</button></div>}
    </section>
  );
}
