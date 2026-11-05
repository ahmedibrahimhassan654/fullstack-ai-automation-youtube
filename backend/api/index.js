import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

// Cache the connection across warm invocations (serverless).
let dbPromise = null;

async function ensureDb() {
  if (!dbPromise) {
    dbPromise = connectDB().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export default async function handler(req, res) {
  try {
    await ensureDb();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: err?.message,
    });
  }
  return app(req, res);
}
