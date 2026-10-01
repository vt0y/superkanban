import { describe, expect, it } from 'vitest';
import { canvaDefaultTitle, canvaDocumentId, canvaEditUrl, parseCanvaInput } from './canva-link';

describe('parseCanvaInput', () => {
  it('reads collaboration edit links and ignores tracking params', () => {
    expect(parseCanvaInput('  https://www.canva.com/design/DAGx1y2Z3a4/AbC-dEf_123/edit?utm_content=DAGx1y2Z3a4&utm_campaign=designshare&utm_medium=link2&utm_source=sharebutton  '))
      .toEqual({ ok: true, link: { designId: 'DAGx1y2Z3a4', editToken: 'AbC-dEf_123' } });
  });

  it('reads tokenless edit links that rely on Canva team access', () => {
    expect(parseCanvaInput('https://canva.com/design/DAGx1y2Z3a4/edit')).toEqual({ ok: true, link: { designId: 'DAGx1y2Z3a4' } });
  });

  it('rejects view links with a specific error', () => {
    expect(parseCanvaInput('https://www.canva.com/design/DAGx1y2Z3a4/AbC-dEf_123/view')).toEqual({ ok: false, error: 'view_link' });
    expect(parseCanvaInput('https://www.canva.com/design/DAGx1y2Z3a4/watch')).toEqual({ ok: false, error: 'view_link' });
  });

  it('rejects short links, embed HTML, other hosts, plain http and malformed IDs', () => {
    expect(parseCanvaInput('   ')).toEqual({ ok: false, error: 'empty' });
    expect(parseCanvaInput('https://canva.link/abc123')).toEqual({ ok: false, error: 'short_link' });
    expect(parseCanvaInput('<iframe src="https://www.canva.com/design/DAGx1y2Z3a4/view?embed"></iframe>')).toEqual({ ok: false, error: 'invalid' });
    expect(parseCanvaInput('http://www.canva.com/design/DAGx1y2Z3a4/edit')).toEqual({ ok: false, error: 'invalid' });
    expect(parseCanvaInput('https://evil.example/design/DAGx1y2Z3a4/edit')).toEqual({ ok: false, error: 'invalid' });
    expect(parseCanvaInput('https://www.canva.com.evil.example/design/DAGx1y2Z3a4/edit')).toEqual({ ok: false, error: 'invalid' });
    expect(parseCanvaInput('https://www.canva.com/design/DA%2F/edit')).toEqual({ ok: false, error: 'invalid' });
    expect(parseCanvaInput('https://www.canva.com/design/DAGx1y2Z3a4/bad.token/edit')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('Canva URL builders', () => {
  it('rebuilds edit URLs from stored IDs and tokens', () => {
    expect(canvaEditUrl({ canvaDesignId: 'DAGx1y2Z3a4', canvaEditToken: 'AbC-dEf_123' })).toBe('https://www.canva.com/design/DAGx1y2Z3a4/AbC-dEf_123/edit');
    expect(canvaEditUrl({ canvaDesignId: 'DAGx1y2Z3a4' })).toBe('https://www.canva.com/design/DAGx1y2Z3a4/edit');
    expect(canvaDocumentId('DAGx1y2Z3a4')).toBe('canva_DAGx1y2Z3a4');
    expect(canvaDefaultTitle('DAGx1y2Z3a4')).toBe('Canva · DAGx1y2Z3a4');
  });
});
