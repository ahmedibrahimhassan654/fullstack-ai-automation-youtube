import mongoose from 'mongoose';
import { env } from './env.js';

export const connectDB = async () => {
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`[db] MongoDB connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.error('[db] MongoDB connection failed:', error.message);
    // Do not kill the process in serverless environments – let the caller decide.
    throw error;
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('[db] MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('[db] MongoDB error:', err);
});
