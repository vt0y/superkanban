import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timestamp } from 'firebase/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { Invite } from '@/types';
import { InviteAcceptCard } from './InviteAcceptCard';

const invite: Invite = { id: 'link', projectId: 'project', projectName: 'Private Project Name', createdBy: 'owner', createdByName: 'Private Inviter Name', role: 'admin', status: 'active', expiresAt: Timestamp.fromMillis(2000) };
const render = (overrides: Partial<Parameters<typeof InviteAcceptCard>[0]> = {}) => renderToStaticMarkup(createElement(InviteAcceptCard, {
  invite, locale: 'en', projectsLoaded: true, alreadyMember: false, now: 1000, online: true, busy: false,
  failure: null, acceptUnavailable: false, error: '', onRetry: vi.fn(), onHome: vi.fn(), onOpenProject: vi.fn(), onAccept: vi.fn(), ...overrides,
}));
const states = [
  { status: 'paused' as const }, { status: 'revoked' as const },
  { expiresAt: Timestamp.fromMillis(1000) }, { maxUses: 1, usesCount: 1 },
];
const privateDetails = (html: string) => {
  expect(html).not.toContain(invite.projectName);
  expect(html).not.toContain(invite.createdByName);
  expect(html).not.toContain('an Admin');
  expect(html).not.toContain('Join project');
};

describe('invite accept presentation', () => {
  it('shows the active invitation to a new member', () => {
    const html = render();
    expect(html).toContain(invite.projectName);
    expect(html).toContain(invite.createdByName);
    expect(html).toContain('an Admin');
    expect(html).toContain('Join project');
  });
  it('waits for membership data without flashing invitation details', () => {
    const html = render({ projectsLoaded: false });
    expect(html).toContain('Loading');
    privateDetails(html);
  });
  it('shows identical public text for unavailable links, missing links and denied reads', () => {
    const baseline = render({ failure: 'denied', invite: undefined });
    for (const change of states) {
      const html = render({ invite: { ...invite, ...change } });
      expect(html).toBe(baseline);
      privateDetails(html);
    }
    expect(render({ invite: null })).toBe(baseline);
    expect(render({ failure: 'denied' })).toBe(baseline);
    expect(render({ acceptUnavailable: true })).toBe(baseline);
    expect(baseline).toContain('Back to home');
    expect(baseline).toContain('Check link again');
  });
  it('keeps existing member access while showing the actual link state', () => {
    const active = render({ alreadyMember: true });
    expect(active).toContain('Open project');
    expect(active).not.toContain('invited you');
    expect(active).not.toContain('an Admin');
    for (const [index, change] of states.entries()) {
      const html = render({ invite: { ...invite, ...change }, alreadyMember: true });
      expect(html).toContain(['paused', 'revoked', 'expired', 'usage limit'][index]);
      expect(html).toContain('your existing access');
      expect(html).toContain('Open project');
      expect(html).toContain(invite.projectName);
      expect(html).not.toContain('Join project');
      expect(html).not.toContain('invited you');
      expect(html).not.toContain('an Admin');
      expect(html.match(/already a member/g)).toHaveLength(1);
    }
  });
  it('shows expiry in Thai for members without repeating the joining role', () => {
    const html = render({ alreadyMember: true, locale: 'th', invite: { ...invite, expiresAt: Timestamp.fromMillis(1000) } });
    expect(html).toContain('ลิงก์เชิญนี้หมดอายุแล้ว');
    expect(html).toContain('คุณยังเปิดโปรเจกต์ได้ตามสิทธิ์เดิม');
    expect(html).not.toContain('เข้าร่วมในฐานะ');
  });
  it('switches expired previews back to the join view when extended', () => {
    expect(render({ now: 2000 })).toContain('invalid or no longer available');
    expect(render({ now: 2000, invite: { ...invite, expiresAt: Timestamp.fromMillis(3000) } })).toContain('Join project');
  });
  it('keeps offline and retryable load failures distinct from invalid invitations', () => {
    const offline = render({ invite: undefined, online: false });
    expect(offline).toContain('offline');
    expect(offline).toContain('Retry');
    expect(offline).not.toContain('invalid');
    const failure = render({ failure: 'retryable', error: 'Connection failed' });
    expect(failure).toContain('Connection failed');
    privateDetails(failure);
    expect(failure).not.toContain('invalid');
    expect(render({ online: false })).toMatch(/disabled=""[^>]*>Join project/);
  });
});
