import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lockBodyScroll, resetBodyScrollLock } from './scroll-lock';

const body = { style: { overflow: '' } };

describe('lockBodyScroll', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { body });
    body.style.overflow = '';
    resetBodyScrollLock();
  });

  it('restores scrolling only after every holder releases, in any order', () => {
    const modal = lockBodyScroll();
    const menu = lockBodyScroll();
    expect(body.style.overflow).toBe('hidden');
    modal();
    expect(body.style.overflow).toBe('hidden');
    menu();
    expect(body.style.overflow).toBe('');
  });

  it('ignores double releases and never restores a stale hidden value', () => {
    body.style.overflow = 'hidden';
    const release = lockBodyScroll();
    const other = lockBodyScroll();
    release();
    release();
    expect(body.style.overflow).toBe('hidden');
    other();
    expect(body.style.overflow).toBe('');
  });
});
