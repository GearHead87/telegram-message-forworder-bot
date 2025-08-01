import mongoose from 'mongoose';

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
    collection: 'testUserList',
  },
);

// Create and export the model
export const User = mongoose.model('User', userSchema);
