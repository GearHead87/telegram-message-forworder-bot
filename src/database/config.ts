import mongoose from 'mongoose';
import { mongoURI, databaseName } from '../constant.js';

export async function connectDB() {
  try {
    await mongoose.connect(mongoURI, {
      dbName: databaseName,
    });
    console.log('Connected to MongoDB - TelegramBot Database');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}
