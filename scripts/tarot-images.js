import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif']);
const MAJORS = [
  ['00', 'fool'], ['01', 'magician'], ['02', 'high-priestess'], ['03', 'empress'], ['04', 'emperor'],
  ['05', 'hierophant'], ['06', 'lovers'], ['07', 'chariot'], ['08', 'strength'], ['09', 'hermit'],
  ['10', 'wheel-of-fortune'], ['11', 'justice'], ['12', 'hanged-man'], ['13', 'death'], ['14', 'temperance'],
  ['15', 'devil'], ['16', 'tower'], ['17', 'star'], ['18', 'moon'], ['19', 'sun'], ['20', 'judgement'], ['21', 'world'],
];
const SUITS = ['wands', 'cups', 'swords', 'pentacles'];
const RANKS = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'page', 'knight', 'queen', 'king'];

export const EXPECTED_SLUGS = [
  ...MAJORS.map(([number, name]) => `major-${number}-${name}`),
  ...SUITS.flatMap((suit) => RANKS.map((rank) => `${suit}-${rank}`)),
];

const majorAliases = new Map(MAJORS.flatMap(([number, name]) => {
  const aliases = [name];
  if (name === 'wheel-of-fortune') aliases.push('wheel', 'fortune');
  if (name === 'high-priestess') aliases.push('priestess');
  if (name === 'hanged-man') aliases.push('hangedman', 'hanged-one');
  if (name === 'judgement') aliases.push('judgment');
  return aliases.map((alias) => [normalize(alias), `major-${number}-${name}`]);
}));
const suitAliases = {
  wands: ['wands', 'wand', 'rods', 'rod', 'staves', 'stave'],
  cups: ['cups', 'cup'],
  swords: ['swords', 'sword'],
  pentacles: ['pentacles', 'pentacle', 'coins', 'coin', 'disks', 'disk', 'denarii'],
};
const rankAliases = {
  ace: ['ace', '1', '01'], two: ['two', '2', '02'], three: ['three', '3', '03'], four: ['four', '4', '04'],
  five: ['five', '5', '05'], six: ['six', '6', '06'], seven: ['seven', '7', '07'], eight: ['eight', '8', '08'],
  nine: ['nine', '9', '09'], ten: ['ten', '10'], page: ['page', 'princess', '11'], knight: ['knight', 'prince', '12'],
  queen: ['queen', '13'], king: ['king', '14'],
};

export function normalize(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseTarotFilename(filename) {
  const stem = normalize(basename(filename, extname(filename)));
  if (EXPECTED_SLUGS.includes(stem)) return stem;
  const compact = stem.replace(/-/g, '');

  const wikimediaMinor = compact.match(/^(cups?|pents?|pentacles?|swords?|wands?)(\d{1,2})$/);
  if (wikimediaMinor) {
    const suit = {
      cup: 'cups', cups: 'cups',
      pent: 'pentacles', pents: 'pentacles', pentacle: 'pentacles', pentacles: 'pentacles',
      sword: 'swords', swords: 'swords',
      wand: 'wands', wands: 'wands',
    }[wikimediaMinor[1]];
    const rankNumber = Number(wikimediaMinor[2]);
    if (suit && rankNumber >= 1 && rankNumber <= 14) return `${suit}-${RANKS[rankNumber - 1]}`;
  }

  const compactMajor = compact.match(/^(?:major|maj|arcana|ar|m)(\d{1,2})$/);
  if (compactMajor) return majorByNumber(compactMajor[1]);
  const numberedMajor = stem.match(/(?:^|-)(?:major|maj|arcana|ar|m)?-?(\d{1,2})(?:-|$)/);
  for (const [alias, slug] of majorAliases) {
    if (hasPhrase(stem, alias)) return slug;
  }
  if (/(?:major|maj|arcana)(?:-|$)/.test(stem) && numberedMajor) return majorByNumber(numberedMajor[1]);

  const compactMinor = compact.match(/^(w|c|s|p)(\d{1,2})$/) || compact.match(/^(\d{1,2})(w|c|s|p)$/);
  if (compactMinor) {
    const suitCode = /[wcsp]/.test(compactMinor[1]) ? compactMinor[1] : compactMinor[2];
    const rankNumber = Number(/\d/.test(compactMinor[1]) ? compactMinor[1] : compactMinor[2]);
    const suit = { w: 'wands', c: 'cups', s: 'swords', p: 'pentacles' }[suitCode];
    if (suit && rankNumber >= 1 && rankNumber <= 14) return `${suit}-${RANKS[rankNumber - 1]}`;
  }

  const suit = SUITS.find((candidate) => suitAliases[candidate].some((alias) => hasWord(stem, alias)));
  if (!suit) return null;
  const rank = RANKS.find((candidate) => rankAliases[candidate].some((alias) => hasWord(stem, alias)));
  return rank ? `${suit}-${rank}` : null;
}

function majorByNumber(raw) {
  const number = Number(raw);
  const found = MAJORS.find(([value]) => Number(value) === number);
  return found ? `major-${found[0]}-${found[1]}` : null;
}

function hasWord(stem, word) { return new RegExp(`(?:^|-)${word}(?:-|$)`).test(stem); }
function hasPhrase(stem, phrase) { return stem === phrase || stem.includes(`-${phrase}-`) || stem.startsWith(`${phrase}-`) || stem.endsWith(`-${phrase}`); }

export function inspectDirectory(inputDir) {
  if (!existsSync(inputDir)) return { matches: [], missing: [...EXPECTED_SLUGS], unmatched: [], duplicates: [] };
  const files = readdirSync(inputDir).filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase())).sort();
  const matches = [];
  const unmatched = [];
  const bySlug = new Map();
  for (const file of files) {
    const slug = parseTarotFilename(file);
    if (!slug) { unmatched.push(file); continue; }
    const entry = { file, slug, path: join(inputDir, file) };
    matches.push(entry);
    bySlug.set(slug, [...(bySlug.get(slug) || []), file]);
  }
  const duplicates = [...bySlug.entries()].filter(([, names]) => names.length > 1).map(([slug, names]) => ({ slug, files: names }));
  const missing = EXPECTED_SLUGS.filter((slug) => !bySlug.has(slug));
  return { matches, missing, unmatched, duplicates };
}

function converter() {
  for (const command of ['magick', 'convert', 'cwebp']) {
    const probe = spawnSync(command, ['-version'], { stdio: 'ignore' });
    if (!probe.error) return command;
  }
  return null;
}

function convertToWebp(command, input, output) {
  const args = command === 'cwebp'
    ? ['-quiet', '-q', '86', '-resize', '0', '1400', input, '-o', output]
    : [input, '-auto-orient', '-strip', '-resize', '900x1400>', '-quality', '86', output];
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed for ${basename(input)}: ${result.stderr || result.stdout}`);
}

function printInspection(report, inputDir) {
  console.log(`[tarot-images] ${report.matches.length}/78 mapped from ${inputDir}`);
  if (report.unmatched.length) console.log(`Unmatched (${report.unmatched.length}):\n  ${report.unmatched.join('\n  ')}`);
  if (report.duplicates.length) console.log(`Duplicates (${report.duplicates.length}):\n  ${report.duplicates.map((item) => `${item.slug}: ${item.files.join(', ')}`).join('\n  ')}`);
  if (report.missing.length) console.log(`Missing (${report.missing.length}):\n  ${report.missing.join('\n  ')}`);
}

export function prepareImages({ inputDir, outputDir, force = false }) {
  const report = inspectDirectory(inputDir);
  printInspection(report, inputDir);
  if (report.missing.length || report.unmatched.length || report.duplicates.length || report.matches.length !== 78) {
    throw new Error('Image set is not an exact, unambiguous 78-card deck. Fix the report above before preparing.');
  }
  const command = converter();
  if (!command) throw new Error('Install ImageMagick (`magick`) or WebP tools (`cwebp`) first.');
  mkdirSync(outputDir, { recursive: true });
  const existing = EXPECTED_SLUGS.filter((slug) => existsSync(join(outputDir, `${slug}.webp`)));
  if (existing.length && !force) throw new Error(`Output already contains ${existing.length} card(s). Re-run with --force to replace them.`);

  const sourceManifestPath = join(inputDir, 'source-manifest.json');
  let sourcesBySlug = new Map();
  if (existsSync(sourceManifestPath)) {
    const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
    sourcesBySlug = new Map((sourceManifest.cards || []).map((card) => [card.slug, card]));
  }
  const manifest = [];
  for (const match of report.matches.sort((a, b) => EXPECTED_SLUGS.indexOf(a.slug) - EXPECTED_SLUGS.indexOf(b.slug))) {
    const output = join(outputDir, `${match.slug}.webp`);
    convertToWebp(command, match.path, output);
    const bytes = readFileSync(output);
    manifest.push({
      slug: match.slug,
      source: match.file,
      file: `${match.slug}.webp`,
      bytes: statSync(output).size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(sourcesBySlug.has(match.slug) ? { provenance: sourcesBySlug.get(match.slug) } : {}),
    });
  }
  writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify({ version: 'deck-v1', count: manifest.length, cards: manifest }, null, 2)}\n`);
  writeFileSync(join(outputDir, 'upload-list.txt'), `${manifest.map((item) => `deck-v1/${item.file}`).join('\n')}\n`);
  console.log(`[tarot-images] Prepared ${manifest.length} WebP files with ${command} in ${outputDir}`);
  return manifest;
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const inputDir = resolve(root, process.env.TAROT_IMAGE_INPUT || 'tarot-assets/inbox');
  const outputDir = resolve(root, process.env.TAROT_IMAGE_OUTPUT || 'tarot-assets/upload/deck-v1');
  const args = new Set(process.argv.slice(2));
  if (args.has('--print-expected')) {
    console.log(EXPECTED_SLUGS.map((slug) => `${slug}.webp`).join('\n'));
    return;
  }
  if (args.has('--check')) {
    const report = inspectDirectory(inputDir);
    printInspection(report, inputDir);
    process.exitCode = report.missing.length || report.unmatched.length || report.duplicates.length ? 1 : 0;
    return;
  }
  try { prepareImages({ inputDir, outputDir, force: args.has('--force') }); }
  catch (error) { console.error(`[tarot-images] ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
