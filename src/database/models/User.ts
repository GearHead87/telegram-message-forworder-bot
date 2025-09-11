import mongoose from 'mongoose';
import { userCollectionName } from '../../constant.js';

// Define the user schema
const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    username: {
      type: String,
      required: false,
    },
    source: {
      type: String,
      required: false,

    },
  },
  {
    // Specify the collection name explicitly
    collection: userCollectionName,
  },
);

// Create and export the model
export const User = mongoose.model('User', userSchema);
