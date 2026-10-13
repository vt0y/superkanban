import { useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { loadAdminProjects, loadAdminUsers, setAdminAccountStatus, setAdminProjectArchived, setAdminStaffRole, type AdminProject, type AdminUser } from '@/services/admin';
import { AdminProjectInspector } from './AdminProjectInspector';
import { Modal } from '@/components/common/Modal';
import { Popover } from '@/components/common/Popover';
import { useAdminCollection } from '@/hooks/useAdminCollection';
import { Empty } from '@/components/common/Empty';
import { Icon } from '@/components/common/Icon';
import { toast } from '@/components/toast';
import { adminLoadErrorMessage } from '@/utils/admin-errors';
import { pick } from '@/utils/formatters';

type Entry = AdminUser | AdminProject;
export type AdminStatusFilter = 'all' | 'active' | 'suspended' | 'archived';
type Pending = { entry: Entry; action: 'status' | 'staff' };
const loaders = { users: loadAdminUsers, projects: loadAdminProjects };
function isUser(entry: Entry): entry is AdminUser { return entry.kind === 'user'; }

export function AdminManagement({ context, kind, status, onStatusChange, onChanged }: {
  context: AppContextValue;
  kind: 'users' | 'projects';
  status: AdminStatusFilter;
  onStatusChange: (status: AdminStatusFilter) => void;
  /** Called after a successful write so site-wide counts can refresh. */
  onChanged?: () => void;
}) {
  const { locale } = context;
  const { items, hasMore, loading, loadingMore, error, refresh, retry, loadMore, replace } = useAdminCollection<Entry>(loaders[kind], context.user.uid);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const busy = useRef(new Set<string>());
  const closeMenu = useRef(() => setMenu(null)).current;
  const users = kind === 'users';
  const dateLocale = locale === 'th' ? 'th-TH' : 'en-US';
  const nameOf = (entry: Entry) => isUser(entry) ? entry.displayName || entry.email || entry.id : entry.name || entry.id;
  const stateOf = (entry: Entry) => isUser(entry) ? entry.accountStatus ?? 'active' : entry.archived ? 'archived' : 'active';
  const stateLabel = (state: string) => state === 'suspended' ? pick(locale, 'ถูกระงับ', 'Suspended') : state === 'archived' ? pick(locale, 'เก็บถาวร', 'Archived') : pick(locale, 'ใช้งาน', 'Active');
  const actionLabel = (entry: Entry) => isUser(entry)
    ? entry.accountStatus === 'suspended' ? pick(locale, 'เปิดใช้งาน', 'Reactivate') : pick(locale, 'ระงับผู้ใช้', 'Suspend user')
    : entry.archived ? pick(locale, 'กู้คืนโปรเจกต์', 'Restore project') : pick(locale, 'เก็บถาวร', 'Archive');
  const staffLabel = (entry: AdminUser) => entry.siteRole === 'admin' ? pick(locale, 'ถอนสิทธิ์ผู้ดูแลเว็บ', 'Revoke site admin') : pick(locale, 'ให้สิทธิ์ผู้ดูแลเว็บ', 'Grant site admin');
  const protectedUser = (entry: Entry) => isUser(entry) && (entry.id === context.user.uid || entry.siteRole !== null);
  const canManageStaff = (entry: AdminUser) => context.siteRole === 'owner' && entry.id !== context.user.uid && entry.siteRole !== 'owner';
  const staffBlocked = (entry: AdminUser) => entry.accountStatus === 'suspended' && entry.siteRole !== 'admin';
  const needsReason = (value: Pending | null) => value?.action === 'status' && !isUser(value.entry) && !value.entry.archived;
  const consequence = (value: Pending) => value.action === 'staff'
    ? (value.entry as AdminUser).siteRole === 'admin' ? pick(locale, 'ผู้ใช้นี้จะไม่สามารถเข้าหน้าผู้ดูแลเว็บได้อีก', 'They will lose access to site admin.') : pick(locale, 'ผู้ใช้นี้จะจัดการฟีดแบ็ก ผู้ใช้ และโปรเจกต์ทั้งระบบได้', 'They will be able to manage feedback, users, and projects site-wide.')
    : isUser(value.entry)
      ? value.entry.accountStatus === 'suspended' ? pick(locale, 'ผู้ใช้จะกลับมาใช้งานได้ตามปกติ', 'They will regain normal access.') : pick(locale, 'ผู้ใช้จะเข้าใช้งานไม่ได้ ข้อมูลยังถูกเก็บไว้', 'They will be locked out. Their data is preserved.')
      : value.entry.archived ? pick(locale, 'สมาชิกจะกลับมาแก้ไขโปรเจกต์ได้', 'Members will be able to edit the project again.') : pick(locale, 'ข้อมูลจะถูกเก็บไว้ เฉพาะผู้ดูแลเว็บเท่านั้นที่กู้คืนได้', 'Data is preserved. Only site staff can restore this project.');
  const needle = search.trim().toLocaleLowerCase();
  const visible = items.filter((entry) => {
    const text = isUser(entry) ? `${entry.displayName} ${entry.email} ${entry.id}` : `${entry.name} ${entry.ownerName} ${entry.ownerEmail} ${entry.ownerId} ${entry.id}`;
    return (status === 'all' || stateOf(entry) === status) && text.toLocaleLowerCase().includes(needle);
  });
  const request = (entry: Entry, action: Pending['action']) => {
    closeMenu();
    if (busy.current.has(entry.id)) return;
    if (action === 'status' && protectedUser(entry)) return;
    if (action === 'staff' && (!isUser(entry) || !canManageStaff(entry) || staffBlocked(entry))) return;
    setReason(''); setPending({ entry, action });
  };
  const run = async (target: Pending, moderationReason?: string) => {
    const { entry, action } = target;
    if (busy.current.has(entry.id)) return;
    if (needsReason(target) && !moderationReason?.trim()) return;
    busy.current.add(entry.id); setSaving([...busy.current]);
    try {
      if (action === 'staff' && isUser(entry)) {
        const grant = entry.siteRole !== 'admin';
        await setAdminStaffRole(entry.id, grant, context.user.uid);
        replace(entry.id, { siteRole: grant ? 'admin' : null });
        toast(pick(locale, 'อัปเดตสิทธิ์แล้ว', 'Staff role updated'), 'success');
      } else if (isUser(entry)) {
        const next = entry.accountStatus === 'suspended' ? 'active' : 'suspended';
        await setAdminAccountStatus(entry.id, next, context.user.uid);
        replace(entry.id, { accountStatus: next });
        toast(pick(locale, 'อัปเดตสถานะแล้ว', 'Status updated'), 'success');
      } else {
        await setAdminProjectArchived(entry.id, !entry.archived, context.user.uid, entry.archived ? undefined : moderationReason);
        replace(entry.id, { archived: !entry.archived, moderationArchived: !entry.archived, moderationReason: entry.archived ? '' : moderationReason?.trim() });
        toast(pick(locale, 'อัปเดตสถานะแล้ว', 'Status updated'), 'success');
      }
      setPending(null);
      onChanged?.();
    } catch {
      toast(pick(locale, 'อัปเดตไม่สำเร็จ กรุณารีเฟรชและลองใหม่', 'Update failed. Refresh and retry.'), 'error');
    } finally { busy.current.delete(entry.id); setSaving([...busy.current]); }
  };
  const copyId = async (entry: Entry) => {
    closeMenu();
    try {
      await navigator.clipboard.writeText(entry.id);
      toast(pick(locale, 'คัดลอกรหัสแล้ว', 'ID copied'), 'success');
    } catch {
      toast(pick(locale, 'คัดลอกไม่สำเร็จ', 'Could not copy'), 'error');
    }
  };
  const inspected = items.find((entry): entry is AdminProject => !isUser(entry) && entry.id === inspecting);
  const pendingSaving = pending ? saving.includes(pending.entry.id) : false;
  const pendingLabel = pending ? pending.action === 'staff' ? staffLabel(pending.entry as AdminUser) : actionLabel(pending.entry) : '';
  const destructive = pending ? pending.action === 'status' && stateOf(pending.entry) === 'active' : false;
  return (
    <section className="admin-section" aria-labelledby={`management-${kind}-title`} aria-busy={loading || loadingMore}>
      <header className="admin-section-head">
        <h2 id={`management-${kind}-title`}>{users ? pick(locale, 'จัดการผู้ใช้', 'User management') : pick(locale, 'จัดการโปรเจกต์', 'Project management')}</h2>
        <button type="button" className="icon-button" aria-label={pick(locale, 'รีเฟรช', 'Refresh')} title={pick(locale, 'รีเฟรช', 'Refresh')} disabled={loading || loadingMore || saving.length > 0} onClick={refresh}><Icon name="refresh" /></button>
      </header>
      <div className="admin-toolbar">
        <label className="admin-search"><Icon name="search" /><input type="search" aria-label={users ? pick(locale, 'ค้นหาผู้ใช้', 'Search users') : pick(locale, 'ค้นหาโปรเจกต์', 'Search projects')} placeholder={users ? pick(locale, 'ชื่อ อีเมล หรือ UID', 'Name, email, or UID') : pick(locale, 'ชื่อโปรเจกต์ เจ้าของ หรือรหัส', 'Project, owner, or ID')} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select value={status} aria-label={pick(locale, 'สถานะ', 'Status')} onChange={(event) => onStatusChange(event.target.value as AdminStatusFilter)}>
          <option value="all">{pick(locale, 'ทุกสถานะ', 'All statuses')}</option>
          <option value="active">{stateLabel('active')}</option>
          <option value={users ? 'suspended' : 'archived'}>{stateLabel(users ? 'suspended' : 'archived')}</option>
        </select>
        <span className="admin-loaded" title={pick(locale, 'การค้นหาและตัวกรองใช้กับรายการที่โหลดแล้ว', 'Search and filters apply to loaded records')}>{pick(locale, `โหลดแล้ว ${items.length}`, `${items.length} loaded`)}</span>
      </div>
      {error && <div className="admin-error" role="alert"><span>{adminLoadErrorMessage(error, locale)}</span><button type="button" className="secondary small" disabled={loadingMore || saving.length > 0} onClick={retry}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
      {loading && <p role="status" className="muted">{pick(locale, 'กำลังโหลด…', 'Loading…')}</p>}
      {!!visible.length && <div className={`panel admin-table ${kind}`}>
        <div className="admin-table-head" aria-hidden="true">
          {users
            ? <><span>{pick(locale, 'ผู้ใช้', 'User')}</span><span>{pick(locale, 'สถานะ', 'Status')}</span><span>{pick(locale, 'สิทธิ์', 'Role')}</span><span>{pick(locale, 'สร้างเมื่อ', 'Created')}</span><span /></>
            : <><span>{pick(locale, 'โปรเจกต์', 'Project')}</span><span>{pick(locale, 'เจ้าของ', 'Owner')}</span><span>{pick(locale, 'สมาชิก', 'Members')}</span><span>{pick(locale, 'สถานะ', 'Status')}</span><span /></>}
        </div>
        {visible.map((entry) => {
          const state = stateOf(entry);
          const chip = <span className={`chip ${state === 'active' ? 'admin-active' : 'admin-inactive'}`}>{stateLabel(state)}</span>;
          const statusItem = !protectedUser(entry) && <button type="button" role="menuitem" className={`menu-item ${state === 'active' ? 'danger-item' : ''}`} disabled={saving.includes(entry.id)} onClick={() => request(entry, 'status')}><Icon name={isUser(entry) ? state === 'active' ? 'lock' : 'unlock' : state === 'active' ? 'archive' : 'rotate'} /><span>{actionLabel(entry)}</span></button>;
          const actions = <div className="admin-row-actions">
            {!isUser(entry) && <button type="button" className="secondary small" onClick={() => setInspecting(entry.id)}><Icon name="eye" />{pick(locale, 'ตรวจสอบ', 'Inspect')}</button>}
            <Popover open={menu === entry.id} onClose={closeMenu} label={nameOf(entry)} trigger={<button type="button" className="icon-button" disabled={saving.includes(entry.id)} aria-haspopup="menu" aria-expanded={menu === entry.id} aria-label={pick(locale, `จัดการ ${nameOf(entry)}`, `Manage ${nameOf(entry)}`)} onClick={() => setMenu((current) => current === entry.id ? null : entry.id)}><Icon name="more" /></button>}>
              {isUser(entry) && canManageStaff(entry) && <button type="button" role="menuitem" className="menu-item" disabled={saving.includes(entry.id) || staffBlocked(entry)} onClick={() => request(entry, 'staff')}><Icon name="userPlus" /><span>{staffLabel(entry)}</span></button>}
              {statusItem}
              <button type="button" role="menuitem" className="menu-item" onClick={() => void copyId(entry)}><Icon name="copy" /><span>{isUser(entry) ? pick(locale, 'คัดลอก UID', 'Copy UID') : pick(locale, 'คัดลอกรหัสโปรเจกต์', 'Copy project ID')}</span></button>
            </Popover>
          </div>;
          return isUser(entry)
            ? <article className="admin-row" key={entry.id} aria-busy={saving.includes(entry.id)}>
              <div className="admin-row-main"><span className="admin-avatar" aria-hidden="true">{(entry.displayName || entry.email || '?').slice(0, 1).toUpperCase()}</span><span><strong>{nameOf(entry)}</strong><small>{entry.email}</small></span></div>
              <div>{chip}</div>
              <div className="admin-row-tags">{entry.siteRole ? <span className="chip">{entry.siteRole}</span> : <span className="muted admin-desktop-only">—</span>}{protectedUser(entry) && <span className="chip admin-protected" title={pick(locale, 'บัญชีผู้ดูแลเว็บได้รับการป้องกันจากการระงับ', 'Site staff accounts are protected from suspension')}><Icon name="lock" />{pick(locale, 'ป้องกัน', 'Protected')}</span>}</div>
              <div className="muted admin-row-meta">{entry.createdAt ? entry.createdAt.toDate().toLocaleDateString(dateLocale) : '—'}</div>
              {actions}
            </article>
            : <article className="admin-row" key={entry.id} aria-busy={saving.includes(entry.id)}>
              <div className="admin-row-main"><span><strong>{nameOf(entry)}</strong>{entry.moderationArchived && <small className="admin-summary-warning">{pick(locale, 'เก็บโดยผู้ดูแลเว็บ', 'Archived by site staff')}: {entry.moderationReason}</small>}</span></div>
              <div className="admin-row-owner"><span>{entry.ownerName}</span>{entry.ownerEmail && <small className="muted">{entry.ownerEmail}</small>}</div>
              <div className="muted admin-row-meta"><Icon name="team" />{entry.memberIds.length}</div>
              <div>{chip}</div>
              {actions}
            </article>;
        })}
      </div>}
      {!loading && !error && !visible.length && <Empty icon={users ? 'team' : 'folder'} title={pick(locale, 'ไม่พบรายการ', 'No matching records')} description={pick(locale, 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง หรือโหลดเพิ่มเติม', 'Try another search or filter, or load more.')} />}
      {hasMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingMore || saving.length > 0 || !!error} onClick={() => void loadMore()}>{loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดเพิ่มเติม', 'Load more')}</button></div>}
      {inspected && <AdminProjectInspector key={inspected.id} context={context} project={inspected} onClose={() => setInspecting(null)} />}
      {pending && <Modal title={pendingLabel} onClose={() => { if (!busy.current.has(pending.entry.id)) setPending(null); }}>
        <form className="stack-form admin-confirm-form" onSubmit={(event) => { event.preventDefault(); void run(pending, needsReason(pending) ? reason : undefined); }}>
          <p><strong>{nameOf(pending.entry)}</strong></p>
          <p className="muted">{consequence(pending)}</p>
          {needsReason(pending) && <label>{pick(locale, 'เหตุผล (สมาชิกมองเห็นได้)', 'Reason (visible to project members)')}<textarea required maxLength={1000} value={reason} disabled={pendingSaving} onChange={(event) => setReason(event.target.value)} /></label>}
          <div className="form-actions">
            <span />
            <button type="button" className="secondary" disabled={pendingSaving} onClick={() => setPending(null)}>{pick(locale, 'ยกเลิก', 'Cancel')}</button>
            <button type="submit" className={destructive ? 'danger' : 'primary'} disabled={pendingSaving || (needsReason(pending) && !reason.trim())}>{pendingSaving ? pick(locale, 'กำลังบันทึก…', 'Saving…') : pendingLabel}</button>
          </div>
        </form>
      </Modal>}
    </section>
  );
}
