/**
 * Migration bundle creator — packages code + database into one portable archive
 * that can be copied to a new machine (USB drive / external disk / network share).
 *
 * What it collects:
 *   1. Project source (git history included, node_modules / build output excluded)
 *   2. backend/.env and frontend/.env.local  (secrets — keep the archive private)
 *   3. MongoDB dumps of the app database(s)  (users, videos, OAuth tokens, ...)
 *   4. SETUP.md — step-by-step instructions for the new machine
 *
 * Usage:
 *   node scripts/createMigrationBundle.mjs            # app db only
 *   node scripts/createMigrationBundle.mjs --all      # every non-system database
 *   node scripts/createMigrationBundle.mjs --no-env   # skip .env files
 *   node scripts/createMigrationBundle.mjs --no-zip   # keep folder only
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.history',
  'backup',
  'dist',
  '.vercel',
  'coverage',
  '.turbo',
]);
const SKIP_FILES = ['.DS_Store', 'Thumbs.db'];
const SKIP_EXT = ['.log'];

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

function copyTree(src, dest, { skipEnv, exclude }) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (shouldSkipDir(entry)) continue;
      if (exclude && exclude.has(path.resolve(src, entry))) continue;
      if (skipEnv && (entry === '.env' || entry === '.env.local')) continue;
      const s = path.join(src, entry);
      const d = path.join(dest, entry);
      const st = fs.statSync(s);
      if (st.isDirectory()) {
        copyTree(s, d, { skipEnv, exclude });
      } else {
        if (SKIP_FILES.includes(entry)) continue;
        if (SKIP_EXT.includes(path.extname(entry))) continue;
        fs.copyFileSync(s, d);
      }
    }
  }
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

// ---------- step 1: create bundle dir ----------
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const bundleName = `migration-bundle-${stamp}`;
const bundleDir = path.join(ROOT, bundleName);
const projectDir = path.join(bundleDir, 'project');
const dumpsDir = path.join(bundleDir, 'databases');

fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(dumpsDir, { recursive: true });

console.log(`[bundle] Creating ${bundleName}`);

// ---------- step 2: copy project ----------
console.log('[bundle] Copying project source (excluding node_modules, .next, logs)...');
const excludePaths = new Set([path.resolve(bundleDir)]);
copyTree(ROOT, projectDir, { skipEnv: has('no-env'), exclude: excludePaths });
// remove the bundle folder from its own copy
const selfCopy = path.join(projectDir, bundleName);
if (fs.existsSync(selfCopy)) fs.rmSync(selfCopy, { recursive: true, force: true });
console.log(`[bundle] Project copied: ${humanSize(dirSize(projectDir))}`);

// ---------- step 3: dump databases ----------
const migrationScript = path.join(ROOT, 'backend', 'scripts', 'dataMigration.mjs');

// Read the default database name from backend/.env so the dump file is named correctly.
function defaultDbName() {
  try {
    const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
    const m = envText.match(/^MONGODB_URI\s*=\s*(.+)$/m);
    if (m) {
      const uri = m[1].trim().replace(/^["']|["']$/g, '');
      const name = uri.split('/').pop().split('?')[0];
      if (name) return name;
    }
  } catch {
    /* .env missing — fall through */
  }
  return 'ai_youtube_automation';
}

function exportDb(dbName) {
  const outFile = path.join(dumpsDir, `mongo-${dbName}.json`);
  const args = dbName
    ? ['export', '--db', dbName, '--out', outFile]
    : ['export', '--out', outFile];
  const res = spawnSync(process.execPath, [migrationScript, ...args], {
    cwd: path.join(ROOT, 'backend'),
    stdio: 'inherit',
  });
  return res.status === 0;
}

console.log('[bundle] Dumping MongoDB data...');
if (has('all')) {
  const status = spawnSync(process.execPath, [migrationScript, 'status'], {
    cwd: path.join(ROOT, 'backend'),
    encoding: 'utf8',
  });
  const names = new Set();
  for (const line of (status.stdout || '').split('\n')) {
    const m = line.match(/^DB:\s+(\S+)/);
    if (m && !['admin', 'config', 'local'].includes(m[1])) names.add(m[1]);
  }
  for (const name of names) {
    console.log(`[bundle] -> dumping database "${name}"`);
    exportDb(name);
  }
} else {
  exportDb(defaultDbName());
}

// ---------- step 4: write SETUP.md ----------
const setup = `# Setup on the new machine

Generated: ${new Date().toISOString()}
Contents: project source + MongoDB dumps + environment files.

> This archive contains API keys and password hashes. Keep it private and
> delete it once the new machine is verified.

## 1. Install prerequisites

- Node.js 18+ (check: \`node -v\`)
- MongoDB Community Server 7.x — https://www.mongodb.com/try/download/community
  - Windows: install as a service (default), it will listen on 127.0.0.1:27017
- Git (only if you want to keep using the remotes)

## 2. Open the project

\`\`\`bash
cd project
\`\`\`

## 3. Install dependencies

\`\`\`bash
cd backend  && npm install
cd ../frontend && npm install
\`\`\`

## 4. Check the environment files

These are already in the archive (skip if you used \`--no-env\`):

- \`backend/.env\`      — MONGODB_URI, JWT_SECRET, API keys, YouTube OAuth, Cloudinary
- \`frontend/.env.local\` — NEXT_PUBLIC_API_URL

Change \`JWT_SECRET\` if you want to invalidate every issued token.
Keep \`MONGODB_URI=mongodb://127.0.0.1:27017/ai_youtube_automation\`.

## 5. Restore the database

\`\`\`bash
cd backend
npm run data:status                    # confirm MongoDB is reachable
npm run data:import -- ../databases/mongo-ai_youtube_automation.json --drop
\`\`\`

\`--drop\` replaces existing documents — use it for a clean restore.
Verify with \`npm run data:status\` (expect 7 users, 11 videos).

## 6. Run the apps

\`\`\`bash
# Terminal 1
cd backend && npm run dev      # http://localhost:5000

# Terminal 2
cd frontend && npm run dev    # http://localhost:3000
\`\`\`

## 7. Sign in

Users keep their existing password hashes — log in with the same
email/password you used on the old machine.

YouTube channels stay connected because the OAuth refresh tokens were
migrated with the database. If a channel shows as disconnected, re-authorise
it (Google may require re-consent for a new machine).

## Optional: keep git history

The archive already includes \`.git\`. To reconnect to GitHub:

\`\`\`bash
git remote -v
git push --all
\`\`\`

## Notes

- Media (videos, audio, thumbnails) lives in Cloudinary, not on this machine.
- Redis is configured but unused — no queue state to migrate.
- Temporary TTS/dubbing files in the OS temp folder are disposable.
`;

fs.writeFileSync(path.join(bundleDir, 'SETUP.md'), setup);

// ---------- step 5: zip ----------
let zipPath = null;
if (!has('no-zip')) {
  zipPath = path.join(ROOT, `${bundleName}.zip`);
  console.log('[bundle] Creating zip archive...');
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${bundleDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  if (ps.status !== 0) {
    console.warn('[bundle] Zip failed — the folder is still usable.');
    zipPath = null;
  }
}

// ---------- summary ----------
console.log('\n================================================');
console.log(' Bundle ready');
console.log('================================================');
console.log(` Folder : ${bundleDir}  (${humanSize(dirSize(bundleDir))})`);
if (zipPath) console.log(` Zip    : ${zipPath}  (${humanSize(fs.statSync(zipPath).size)})`);
console.log(' Dumps  :');
for (const f of fs.readdirSync(dumpsDir)) {
  console.log(`   - ${f} (${humanSize(fs.statSync(path.join(dumpsDir, f)).size)})`);
}
console.log('\n Next: copy the folder or zip to the new machine, unzip,');
console.log('       then follow SETUP.md inside it.');
console.log('================================================');
