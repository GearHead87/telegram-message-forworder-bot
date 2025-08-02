import mongoose from 'mongoose';

// Define the admin user schema
const adminUserSchema = new mongoose.Schema(
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
    firstName: {
      type: String,
      required: false,
    },
    lastName: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    addedBy: {
      type: String,
      required: false, // userId of the admin who added this admin
    },
  },
  {
    // Specify the collection name explicitly
    collection: 'adminUsers',
  },
);

// Create and export the model
export const AdminUser = mongoose.model('AdminUser', adminUserSchema); 