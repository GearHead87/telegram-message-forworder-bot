import mongoose from 'mongoose';
import { env } from '../env.js';

export async function connectDB() {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.DATABASE_NAME,
    });
    console.log('Connected to MongoDB - TelegramBot Database');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}
