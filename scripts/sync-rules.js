import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function getRawAllowedDomains() {
  const envLocal = loadEnvFile(path.join(rootDir, '.env.local'));
  const env = loadEnvFile(path.join(rootDir, '.env'));
  return (
    process.env.ALLOWED_EMAIL_DOMAINS ||
    process.env.VITE_ALLOWED_EMAIL_DOMAINS ||
    envLocal.ALLOWED_EMAIL_DOMAINS ||
    envLocal.VITE_ALLOWED_EMAIL_DOMAINS ||
    env.ALLOWED_EMAIL_DOMAINS ||
    env.VITE_ALLOWED_EMAIL_DOMAINS ||
    ''
  );
}

function parseDomains(raw) {
  if (!raw) return [];
  const parts = raw
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter((d) => d.length > 0);
  return Array.from(new Set(parts));
}

function domainToRegex(domain) {
  const clean = domain.trim().toLowerCase().replace(/^@/, '');
  const escaped = clean
    .split('')
    .map((c) => {
      if (/[a-z]/.test(c)) {
        return `[${c.toLowerCase()}${c.toUpperCase()}]`;
      }
      if (c === '.') {
        return '[.]';
      }
      return c;
    })
    .join('');
  return `^[a-zA-Z0-9._%+-]+@${escaped}$`;
}

function generateFunctionBody(domains) {
  if (domains.length === 0) {
    return "    function isAllowedEmail(email) {\n      return email is string && email.matches('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$');\n    }";
  }
  if (domains.length === 1) {
    const regex = domainToRegex(domains[0]);
    return `    function isAllowedEmail(email) {\n      return email is string && email.matches('${regex}');\n    }`;
  }
  const lines = domains.map((d) => `        || email.matches('${domainToRegex(d)}')`);
  // Remove leading '        || ' from the first one
  lines[0] = `        email.matches('${domainToRegex(domains[0])}')`;
  return `    function isAllowedEmail(email) {\n      return email is string && (\n${lines.join('\n')}\n      );\n    }`;
}

export function syncFirestoreRules() {
  const rulesPath = path.join(rootDir, 'firestore.rules');
  if (!fs.existsSync(rulesPath)) {
    console.error(`firestore.rules not found at ${rulesPath}`);
    return false;
  }

  const rawDomains = getRawAllowedDomains();
  const domains = parseDomains(rawDomains);
  const functionCode = generateFunctionBody(domains);

  let content = fs.readFileSync(rulesPath, 'utf8');

  const startMarker = '// [ALLOWED_EMAIL_DOMAINS_START]';
  const endMarker = '// [ALLOWED_EMAIL_DOMAINS_END]';

  if (content.includes(startMarker) && content.includes(endMarker)) {
    const startIndex = content.indexOf(startMarker) + startMarker.length;
    const endIndex = content.indexOf(endMarker);
    content = content.slice(0, startIndex) + '\n' + functionCode + '\n    ' + content.slice(endIndex);
  }

  // Ensure match /users/{uid} uses isAllowedEmail
  content = content.replace(
    /allow create: if signedIn\(\) && uid == request\.auth\.uid\s+&& request\.resource\.data\.email == request\.auth\.token\.email\s+&& isAllowedEmail\(request\.auth\.token\.email\);/,
    () => `allow create: if signedIn() && uid == request.auth.uid\n        && request.resource.data.email == request.auth.token.email\n        && isAllowedEmail(request.auth.token.email);`,
  );

  fs.writeFileSync(rulesPath, content, 'utf8');
  console.log(`[sync-rules] Synced firestore.rules with allowed domains: [${domains.join(', ')}]`);
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('sync-rules.js')) {
  syncFirestoreRules();
}
