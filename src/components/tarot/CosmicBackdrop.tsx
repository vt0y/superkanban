import { useEffect, useMemo, useRef } from 'react';

/** Deterministic pseudo-random numbers, so the sky is the same on every visit. */
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/** One element per star layer: the stars are box-shadows on a 1px dot, tiled across a 2000px square. */
function starField(count: number, seed: number, size: number): string {
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const x = Math.round(random() * 2000);
    const y = Math.round(random() * 2000);
    const alpha = (0.35 + random() * 0.65).toFixed(2);
    return `${x}px ${y}px 0 ${size}px rgba(255, 248, 230, ${alpha})`;
  }).join(', ');
}

/** Night sky: drifting nebulae, two twinkling star layers, a shooting star, and pointer parallax on desktop. */
export function CosmicBackdrop() {
  const root = useRef<HTMLDivElement>(null);
  const near = useMemo(() => starField(70, 7, 1), []);
  const far = useMemo(() => starField(160, 42, 0), []);

  useEffect(() => {
    const element = root.current;
    if (!element || !window.matchMedia('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--mx', (event.clientX / window.innerWidth - 0.5).toFixed(3));
        element.style.setProperty('--my', (event.clientY / window.innerHeight - 0.5).toFixed(3));
      });
    };
    addEventListener('pointermove', move);
    return () => { removeEventListener('pointermove', move); cancelAnimationFrame(frame); };
  }, []);

  return (
    <div ref={root} className="arc-sky" aria-hidden="true">
      <i className="arc-nebula one" />
      <i className="arc-nebula two" />
      <i className="arc-nebula three" />
      <span className="arc-stars far" style={{ boxShadow: far }} />
      <span className="arc-stars near" style={{ boxShadow: near }} />
      <i className="arc-shooting" />
    </div>
  );
}
