import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EXPECTED_SLUGS, parseTarotFilename } from './tarot-images.js';

export const WIKIMEDIA_CATEGORY = 'Category:Rider-Waite-Smith tarot deck (TaionWC)';
export const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'ProjectSpaceTarotAssetImporter/1.0 (Wikimedia Commons source verification)';

export function mapWikimediaTitle(title) {
  return parseTarotFilename(title.replace(/^File:/, ''));
}

export function isPublicDomainMetadata(extmetadata = {}) {
  const license = String(extmetadata.LicenseShortName?.value || '').toLowerCase();
  const copyrighted = String(extmetadata.Copyrighted?.value || '').toLowerCase();
  const usageTerms = String(extmetadata.UsageTerms?.value || '').toLowerCase();
  return copyrighted === 'false' && (license.includes('public domain') || usageTerms.includes('public domain'));
}

function apiUrl(params) {
  const url = new URL(WIKIMEDIA_API);
  Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params })
    .forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function fetchJson(params, fetchImpl) {
  const response = await fetchImpl(apiUrl(params), { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Wikimedia API returned HTTP ${response.status}`);
  return response.json();
}

async function categoryTitles(fetchImpl) {
  const titles = [];
  let cmcontinue;
  do {
    const data = await fetchJson({
      action: 'query', list: 'categorymembers', cmtitle: WIKIMEDIA_CATEGORY,
      cmtype: 'file', cmlimit: 'max', ...(cmcontinue ? { cmcontinue } : {}),
    }, fetchImpl);
    titles.push(...(data.query?.categorymembers || []).map((item) => item.title));
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);
  return titles;
}

async function imageInfo(titles, fetchImpl) {
  const pages = [];
  for (let index = 0; index < titles.length; index += 50) {
    const data = await fetchJson({
      action: 'query', prop: 'imageinfo', titles: titles.slice(index, index + 50).join('|'),
      iiprop: 'url|size|mime|sha1|extmetadata',
      iiurlwidth: '900',
      iiextmetadatafilter: 'LicenseShortName|Copyrighted|UsageTerms|Artist|Credit',
    }, fetchImpl);
    pages.push(...(data.query?.pages || []));
  }
  return pages;
}

export function validateWikimediaPages(pages) {
  const cards = pages.map((page) => {
    const info = page.imageinfo?.[0];
    const slug = mapWikimediaTitle(page.title || '');
    if (!slug) throw new Error(`Cannot map Wikimedia filename: ${page.title}`);
    if (!info?.url) throw new Error(`Missing original image URL: ${page.title}`);
    if (!String(info.mime || '').startsWith('image/')) throw new Error(`Unexpected MIME type for ${page.title}: ${info.mime || 'missing'}`);
    if (!isPublicDomainMetadata(info.extmetadata)) throw new Error(`File is not verified as Public Domain: ${page.title}`);
    return { page, info, slug };
  });
  const found = new Set(cards.map((card) => card.slug));
  const duplicates = cards.filter((card, index) => cards.findIndex((candidate) => candidate.slug === card.slug) !== index);
  const missing = EXPECTED_SLUGS.filter((slug) => !found.has(slug));
  if (cards.length !== 78 || found.size !== 78 || duplicates.length || missing.length) {
    throw new Error(`Wikimedia deck must map exactly 78 unique cards (received ${cards.length}, unique ${found.size}, missing ${missing.join(', ') || 'none'})`);
  }
  return cards.sort((a, b) => EXPECTED_SLUGS.indexOf(a.slug) - EXPECTED_SLUGS.indexOf(b.slug));
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export function canonicalOriginalUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function pause(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function downloadFile(url, destination, fetchImpl) {
  const originalUrl = canonicalOriginalUrl(url);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetchImpl(originalUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Downloaded an empty image: ${originalUrl}`);
      writeFileSync(destination, bytes);
      return { bytes, originalUrl };
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Image download returned HTTP ${response.status}: ${originalUrl}`);
    }
    if (attempt === 4) throw new Error(`Image download returned HTTP ${response.status} after 5 attempts: ${originalUrl}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    const requestedDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** attempt);
    await pause(Math.min(requestedDelay, 30_000));
  }
  throw new Error(`Image download failed: ${originalUrl}`);
}

export async function downloadWikimediaDeck({ outputDir, force = false, fetchImpl = fetch }) {
  const titles = await categoryTitles(fetchImpl);
  if (titles.length !== 78) throw new Error(`Expected 78 files in Wikimedia category, received ${titles.length}`);
  const cards = validateWikimediaPages(await imageInfo(titles, fetchImpl));
  mkdirSync(outputDir, { recursive: true });
  const existingImages = readdirSync(outputDir).filter((file) => /^.+\.(?:jpe?g|png|webp|tiff?|avif)$/i.test(file));
  if (existingImages.length && !force) {
    throw new Error(`Inbox already contains ${existingImages.length} image(s). Re-run with --force only if replacing the entire set is intended.`);
  }

  const stagingDir = mkdtempSync(join(tmpdir(), 'projectspace-tarot-wikimedia-'));
  try {
    const manifestCards = [];
    for (const [index, card] of cards.entries()) {
      const downloadUrl = card.info.thumburl || card.info.url;
      const extension = extname(new URL(downloadUrl).pathname).toLowerCase() || '.jpg';
      const filename = `${card.slug}${extension}`;
      const downloaded = await downloadFile(downloadUrl, join(stagingDir, filename), fetchImpl);
      manifestCards.push({
        slug: card.slug,
        file: filename,
        wikimediaTitle: card.page.title,
        descriptionUrl: card.info.descriptionurl,
        originalUrl: canonicalOriginalUrl(card.info.url),
        downloadUrl: downloaded.originalUrl,
        mime: card.info.mime,
        originalWidth: card.info.width,
        originalHeight: card.info.height,
        width: card.info.thumbwidth || card.info.width,
        height: card.info.thumbheight || card.info.height,
        bytes: downloaded.bytes.length,
        sha1: card.info.sha1,
        sha256: createHash('sha256').update(downloaded.bytes).digest('hex'),
        license: cleanText(card.info.extmetadata?.LicenseShortName?.value),
        artist: cleanText(card.info.extmetadata?.Artist?.value),
      });
      process.stdout.write(`\r[tarot-images] Downloading ${index + 1}/78`);
      if (index < cards.length - 1) await pause(300);
    }
    process.stdout.write('\n');

    if (force) existingImages.forEach((file) => rmSync(join(outputDir, file)));
    readdirSync(stagingDir).forEach((file) => copyFileSync(join(stagingDir, file), join(outputDir, file)));
    const manifest = {
      version: 'wikimedia-pam-a-v1',
      sourceCategory: 'https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC)',
      downloadedAt: new Date().toISOString(),
      count: manifestCards.length,
      cards: manifestCards,
    };
    writeFileSync(join(outputDir, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`[tarot-images] Downloaded and verified 78 Public Domain card images in ${outputDir}`);
    return manifest;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const outputDir = resolve(root, process.env.TAROT_IMAGE_INPUT || 'tarot-assets/inbox');
  try {
    await downloadWikimediaDeck({ outputDir, force: process.argv.includes('--force') });
  } catch (error) {
    console.error(`[tarot-images] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
