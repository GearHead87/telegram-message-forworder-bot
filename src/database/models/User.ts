import mongoose from 'mongoose';
import { env } from '../../env.js';

// Define the user schema
const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
  },
  {
    // Specify the collection name explicitly
    collection: env.USER_COLLECTION_NAME,
  },
);

// Create and export the model
export const User = mongoose.model('User', userSchema);
