#!/usr/bin/env node
// Guards the design system in src/styles: colours, font sizes and radii come from tokens.css,
// and !important is reserved for reduced-motion (or beating a third-party inline style).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src/styles/', import.meta.url).pathname;
// Themed stages that intentionally keep their own palette and type.
const THEMED = new Set(['tokens.css', 'pages/tarot.css', 'sections/gacha-reveal.css', 'sections/gacha-arcana.css', 'sections/gacha-golden.css', 'sections/gacha-pack.css']);

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : path.endsWith('.css') ? [path] : [];
});

/** Removes var(...) (including nested fallbacks) so raw units left behind are easy to spot. */
const stripVars = (value) => {
  let out = value;
  while (/var\([^()]*\)/.test(out)) out = out.replace(/var\([^()]*\)/g, '');
  return out;
};
const RAW_SIZE = /(^|[^\w.-])\d*\.?\d+(px|rem|pt)\b/;

const problems = [];
for (const file of files(root)) {
  const rel = relative(root, file);
  const themed = THEMED.has(rel);
  const lines = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' ')).split('\n');
  const raw = readFileSync(file, 'utf8').split('\n');
  let reducedMotionDepth = 0;
  let depth = 0;
  lines.forEach((line, index) => {
    const at = `${rel}:${index + 1}`;
    if (/@media\s*\(prefers-reduced-motion/.test(line)) reducedMotionDepth = depth + 1;
    for (const char of line) {
      if (char === '{') depth += 1;
      if (char === '}') { depth -= 1; if (reducedMotionDepth && depth < reducedMotionDepth) reducedMotionDepth = 0; }
    }
    if (themed) return;
    if (line.includes('!important') && !reducedMotionDepth && !/inline style/.test(raw[index])) problems.push(`${at} !important outside reduced-motion`);
    const noUrls = line.replace(/url\([^)]*\)/g, '');
    if (/#[0-9a-fA-F]{3,8}\b/.test(noUrls) || /\b(rgba?|hsla?)\(/.test(noUrls)) problems.push(`${at} raw colour (use a token from tokens.css)`);
    for (const match of noUrls.matchAll(/(font-size|border-radius)\s*:\s*([^;}]+)/g)) {
      if (RAW_SIZE.test(stripVars(match[2]))) problems.push(`${at} raw ${match[1]} "${match[2].trim()}" (use a token)`);
    }
  });
}

if (problems.length) {
  console.error(`check-css: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-css: ${files(root).length} files OK`);
