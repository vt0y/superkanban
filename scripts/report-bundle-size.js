import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dir = path.resolve(__dirname, '../dist/assets');
if (!fs.existsSync(dir)) {
  console.log('[bundle-report] dist/assets directory not found.');
  process.exit(0);
}

const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.map'));
if (!files.length) {
  console.log('[bundle-report] No asset files found.');
  process.exit(0);
}

console.log('');
console.log('+----------------------------------+-----------+-----------+-----------+');
console.log('| Asset File                       | Raw Size  | Gzip      | Brotli    |');
console.log('+----------------------------------+-----------+-----------+-----------+');

let totalRaw = 0;
let totalGz = 0;
let totalBr = 0;

files.sort().forEach((file) => {
  const filePath = path.join(dir, file);
  const data = fs.readFileSync(filePath);
  const raw = data.length;
  const gz = zlib.gzipSync(data, { level: 9 }).length;
  const br = zlib.brotliCompressSync(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
    },
  }).length;

  totalRaw += raw;
  totalGz += gz;
  totalBr += br;

  const rawStr = (raw / 1024).toFixed(1).padStart(7) + ' KB';
  const gzStr = (gz / 1024).toFixed(1).padStart(7) + ' KB';
  const brStr = (br / 1024).toFixed(1).padStart(7) + ' KB';
  const nameStr = file.length > 32 ? file.slice(0, 29) + '...' : file;

  console.log('| ' + nameStr.padEnd(32) + ' | ' + rawStr + ' | ' + gzStr + ' | ' + brStr + ' |');
});

console.log('+----------------------------------+-----------+-----------+-----------+');
const totalRawStr = (totalRaw / 1024).toFixed(1).padStart(7) + ' KB';
const totalGzStr = (totalGz / 1024).toFixed(1).padStart(7) + ' KB';
const totalBrStr = (totalBr / 1024).toFixed(1).padStart(7) + ' KB';
console.log('| ' + 'TOTAL'.padEnd(32) + ' | ' + totalRawStr + ' | ' + totalGzStr + ' | ' + totalBrStr + ' |');
console.log('+----------------------------------+-----------+-----------+-----------+');
const savings = (((totalGz - totalBr) / totalGz) * 100).toFixed(1);
console.log(`Brotli provides ${savings}% additional wire compression over Gzip.`);
console.log('');
