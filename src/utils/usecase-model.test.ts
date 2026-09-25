import { describe, expect, it } from 'vitest';
import { classifyUseCase, clipToShape, nextUseCaseCode, validEdge } from './usecase-model';

describe('usecase-model', () => {
  it('classifies common / extension / base use cases', () => {
    const edges = [
      { from: 'uc1', to: 'uc-auth', kind: 'include' as const },
      { from: 'uc-discount', to: 'uc1', kind: 'extend' as const },
    ];
    expect(classifyUseCase('uc-auth', edges)).toBe('common');
    expect(classifyUseCase('uc-discount', edges)).toBe('extension');
    expect(classifyUseCase('uc1', edges)).toBe('base');
  });

  it('validates UML connection rules', () => {
    expect(validEdge('actor', 'usecase', 'association')).toBe(true);
    expect(validEdge('usecase', 'actor', 'association')).toBe(true);
    expect(validEdge('usecase', 'usecase', 'include')).toBe(true);
    expect(validEdge('usecase', 'usecase', 'extend')).toBe(true);
    expect(validEdge('actor', 'actor', 'association')).toBe(false);
    expect(validEdge('boundary', 'usecase', 'association')).toBe(false);
  });

  it('increments the next use case code', () => {
    expect(nextUseCaseCode([])).toBe('UC-01');
    expect(nextUseCaseCode(['UC-01', 'UC-04'])).toBe('UC-05');
    expect(nextUseCaseCode(['UC-09'])).toBe('UC-10');
  });

  it('clips rays to ellipse boundary', () => {
    const box = { x: 0, y: 0, w: 100, h: 60 };
    // ray heading straight right from center (50, 30) towards (200, 30)
    const right = clipToShape(box, 'usecase', 200, 30);
    expect(right.x).toBeCloseTo(100);
    expect(right.y).toBeCloseTo(30);
  });
});
