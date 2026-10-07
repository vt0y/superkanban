import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timestamp } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import type { Invite, Locale, Role } from '@/types';
import { translate, type MessageKey } from '@/utils/i18n';
import { InviteRow } from './InviteRow';

const base: Invite = { id: 'link', projectId: 'project', projectName: 'Team', role: 'member', status: 'active', createdBy: 'owner', expiresAt: null };
const row = (overrides: Partial<Invite> = {}, role: Role | null = 'owner', readOnly = false, locale: Locale = 'en') => renderToStaticMarkup(createElement(InviteRow, {
  invite: { ...base, ...overrides }, role, readOnly,
  context: { locale, t: (key: MessageKey) => translate(locale, key) } as AppContextValue,
  joined: [], now: 1000, busy: false, blocked: false, onEdit: vi.fn(), onStatus: vi.fn(),
}));
const buttons = (markup: string) => [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).join('\n');
beforeEach(() => vi.stubGlobal('location', { origin: 'https://example.com' }));
afterEach(() => vi.unstubAllGlobals());

describe('invitation row actions', () => {
  it('offers copying for usable links and keeps URL/member details collapsed', () => {
    const html = row();
    expect(buttons(html)).toContain('Copy link');
    expect(html).toMatch(/aria-expanded="false" aria-controls=/);
    expect(html).toMatch(/hidden="" class="invite-entry-details"/);
    expect(html).toContain('https://example.com/invite/link');
    expect(html).toContain('Team invitation');
    expect(html).toContain('0 / Unlimited');
  });
  it('offers the appropriate repair instead of copying for unavailable links', () => {
    expect(buttons(row({ expiresAt: Timestamp.fromMillis(1000) }))).toContain('Extend expiry');
    expect(buttons(row({ maxUses: 1, usesCount: 1 }))).toContain('Increase limit');
    for (const overrides of [{ expiresAt: Timestamp.fromMillis(1000) }, { maxUses: 1, usesCount: 1 }, { status: 'revoked' as const }]) expect(buttons(row(overrides))).not.toContain('Copy link');
    expect(buttons(row({ status: 'revoked' }))).not.toContain('aria-haspopup');
  });
  it('blocks resuming paused links with expired or exhausted limits and explains why', () => {
    for (const overrides of [{ expiresAt: Timestamp.fromMillis(1000) }, { usesCount: 1, maxUses: 1 }]) {
      const html = row({ ...overrides, status: 'paused' });
      expect(buttons(html)).toMatch(/<button[^>]*disabled=""[^>]*>Resume<\/button>/);
      expect(html).toContain('Resuming will still prevent joins');
    }
    expect(buttons(row({ status: 'paused' }))).toMatch(/<button type="button" class="secondary small">Resume<\/button>/);
  });
  it('explains restricted admin-role repairs and hides mutations for read-only/member access', () => {
    const expired = { role: 'admin' as const, expiresAt: Timestamp.fromMillis(1000) };
    const html = row(expired, 'admin');
    expect(buttons(html)).toMatch(/disabled=""[^>]*>Extend expiry/);
    expect(html).toContain('Only the owner can edit admin invitation links');
    expect(buttons(row(expired, 'owner', true))).not.toContain('Extend expiry');
    expect(buttons(row({}, 'member'))).not.toContain('aria-haspopup');
    expect(buttons(row({}, null))).not.toContain('aria-haspopup');
  });
  it('renders Thai labels and omits action-specific controls in revoked history', () => {
    expect(row({}, 'owner', false, 'th')).toContain('ลิงก์เชิญเข้าทีม');
    expect(buttons(row({ status: 'revoked' }, 'owner', false, 'th'))).toContain('รายละเอียด');
    expect(buttons(row({ status: 'revoked' }))).not.toContain('Resume');
  });
});
