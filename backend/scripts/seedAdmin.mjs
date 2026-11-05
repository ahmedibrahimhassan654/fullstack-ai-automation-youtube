import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_youtube_automation';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'ahmedibrahimhassan654@gmail.com').toLowerCase();
const ADMIN_NAME = process.env.ADMIN_NAME || 'Ahmed Ibrahim Hassan';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true, lowercase: true, trim: true },
    password: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    subscription: { type: Object, default: { plan: 'free', status: 'inactive' } },
    preferences: { type: Object, default: { timezone: 'UTC', defaultLanguage: 'en' } },
  },
  { timestamps: true, collection: 'users' }
);

const User = mongoose.model('UserSeed', userSchema);

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  console.log('[seed] Connected to', MONGODB_URI);

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(ADMIN_PASSWORD, salt);

  const result = await User.updateOne(
    { email: ADMIN_EMAIL },
    {
      $set: {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        password: hashed,
        role: 'admin',
        isActive: true,
        subscription: { plan: 'free', status: 'inactive' },
        preferences: { timezone: 'UTC', defaultLanguage: 'en' },
      },
    },
    { upsert: true }
  );

  console.log('[seed] Result:', result);
  console.log('[seed] Admin user ready:');
  console.log('  email   :', ADMIN_EMAIL);
  console.log('  password:', ADMIN_PASSWORD);
  console.log('  role    : admin');

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});