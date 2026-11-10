/**
 * Data migration tool — export/import local MongoDB data between machines.
 *
 * Uses the raw MongoDB driver (NOT mongoose) so that fields marked
 * `select: false` (password hashes, YouTube access/refresh tokens,
 * session refresh tokens) are included in the dump.
 *
 * Usage:
 *   node scripts/dataMigration.mjs status
 *   node scripts/dataMigration.mjs export [--db <name>] [--out <file>]
 *   node scripts/dataMigration.mjs import <file> [--db <name>] [--drop]
 *
 * Examples:
 *   npm run data:status
 *   npm run data:export
 *   npm run data:import -- ../backup/mongo-ai_youtube_automation-2026-01-01.json --drop
 */

import mongo from 'mongodb';
import { EJSON } from 'bson';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { MongoClient } = mongo;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_youtube_automation';
const DEFAULT_DB = process.env.DB_NAME || MONGODB_URI.split('/').pop().split('?')[0] || 'ai_youtube_automation';
const BACKUP_DIR = path.resolve(__dirname, '..', 'backup');

// ---------- arg parsing ----------
const argv = process.argv.slice(2);
const command = argv[0];

function flagValue(name, fallback = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
}
const hasFlag = (name) => argv.includes(`--${name}`);

function usage() {
  console.log(`
MongoDB data migration

  node scripts/dataMigration.mjs status
      List databases, collections and document counts.

  node scripts/dataMigration.mjs export [--db <name>] [--out <file>]
      Dump every collection (documents + indexes) to a single JSON file.
      Output default: backend/backup/mongo-<db>-<timestamp>.json

  node scripts/dataMigration.mjs import <file> [--db <name>] [--drop]
      Restore a dump. Use --drop to replace existing documents.
`);
}

// ---------- helpers ----------
function connect(uri = MONGODB_URI) {
  const client = new MongoClient(uri);
  return client.connect().then(() => client);
}

async function listCollections(db) {
  const cols = await db.listCollections({}, { nameOnly: false }).toArray();
  return cols.map((c) => c.name).filter((n) => !n.startsWith('system.'));
}

// ---------- status ----------
async function runStatus() {
  const client = await connect();
  try {
    const { databases } = await client.db().admin().listDatabases();
    console.log(`Connected to ${MONGODB_URI}\n`);
    for (const d of databases) {
      if (d.name === 'admin' || d.name === 'config' || d.name === 'local') continue;
      const db = client.db(d.name);
      const cols = await listCollections(db);
      console.log(`DB: ${d.name}  (${(d.sizeOnDisk / 1048576).toFixed(2)} MB)`);
      for (const col of cols) {
        const n = await db.collection(col).countDocuments();
        console.log(`   - ${col}: ${n} docs`);
      }
      console.log('');
    }
  } finally {
    await client.close();
  }
}

// ---------- export ----------
async function runExport() {
  const dbName = flagValue('db', DEFAULT_DB);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = flagValue('out', path.join(BACKUP_DIR, `mongo-${dbName}-${stamp}.json`));

  const client = await connect();
  try {
    const db = client.db(dbName);
    const colNames = await listCollections(db);
    if (colNames.length === 0) {
      console.warn(`[export] No collections found in database "${dbName}".`);
      return;
    }

    const payload = {
      meta: {
        tool: 'dataMigration.mjs',
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceUri: MONGODB_URI.replace(/\/\/[^@]*@/, '//***:***@'),
        database: dbName,
      },
      collections: {},
    };

    for (const name of colNames) {
      const docs = await db.collection(name).find({}).toArray();
      const indexes = (await db.collection(name).indexes()).filter((i) => i.name !== '_id_');
      payload.collections[name] = { docs, indexes };
      console.log(`[export] ${name}: ${docs.length} docs, ${indexes.length} indexes`);
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    // canonical EJSON keeps Date / ObjectId / Binary types intact
    fs.writeFileSync(outFile, EJSON.stringify(payload, { relaxed: false }, 0));
    const size = fs.statSync(outFile).size;
    console.log(`\n[export] Done -> ${outFile} (${(size / 1048576).toFixed(2)} MB)`);
    console.log('[export] Copy this file to the new machine and run:');
    console.log(`         npm run data:import -- "${path.basename(outFile)}"`);
  } finally {
    await client.close();
  }
}

// ---------- import ----------
async function runImport() {
  const fileArg = argv.slice(1).find((a) => !a.startsWith('--'));
  if (!fileArg) {
    console.error('[import] Missing dump file path.');
    usage();
    process.exit(1);
  }

  const file = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(file)) {
    console.error(`[import] File not found: ${file}`);
    process.exit(1);
  }

  const payload = EJSON.parse(fs.readFileSync(file, 'utf-8'), { relaxed: false });
  if (!payload || !payload.collections) {
    console.error('[import] Invalid dump file: missing "collections".');
    process.exit(1);
  }

  const dbName = flagValue('db', payload.meta?.database || DEFAULT_DB);
  const drop = hasFlag('drop');

  const client = await connect();
  try {
    const db = client.db(dbName);
    for (const [name, { docs, indexes }] of Object.entries(payload.collections)) {
      const col = db.collection(name);

      if (drop) {
        await col.deleteMany({});
        console.log(`[import] ${name}: cleared existing documents`);
      }

      const existing = await col.countDocuments();
      if (existing > 0 && !drop) {
        console.log(
          `[import] ${name}: SKIPPED (${existing} docs already exist). Re-run with --drop to overwrite.`
        );
        continue;
      }

      if (docs.length > 0) {
        await col.insertMany(docs, { ordered: false });
      }

      for (const idx of indexes || []) {
        try {
          await col.createIndexes([idx]);
        } catch (err) {
          console.warn(`[import] ${name}: index "${idx.name}" not created (${err.message})`);
        }
      }

      console.log(`[import] ${name}: restored ${docs.length} docs, ${(indexes || []).length} indexes`);
    }
    console.log(`\n[import] Done. Database "${dbName}" is ready.`);
  } finally {
    await client.close();
  }
}

// ---------- run ----------
try {
  if (command === 'status') await runStatus();
  else if (command === 'export') await runExport();
  else if (command === 'import') await runImport();
  else {
    usage();
    process.exit(command ? 1 : 0);
  }
  process.exit(0);
} catch (err) {
  console.error('[migrate] Failed:', err);
  process.exit(1);
}
