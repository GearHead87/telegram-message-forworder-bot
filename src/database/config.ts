import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { mongoURI } from '../constant';

dotenv.config();

export async function connectDB() {
  try {
    await mongoose.connect(mongoURI, {
      dbName: 'TelegramBot',
    });
    console.log('Connected to MongoDB - TelegramBot Database');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}
