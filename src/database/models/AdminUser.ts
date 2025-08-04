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
    // GramJS session data for user account authentication
    gramjsSession: {
      type: String,
      required: false, // StringSession data
    },
    gramjsApiId: {
      type: Number,
      required: false, // Telegram API ID
    },
    gramjsApiHash: {
      type: String,
      required: false, // Telegram API Hash
    },
    gramjsPhoneNumber: {
      type: String,
      required: false, // Phone number used for authentication
    },
    gramjsSetupAt: {
      type: Date,
      required: false, // When gramjs was set up
    },
    gramjsActive: {
      type: Boolean,
      default: false, // Whether gramjs session is active and working
    },
  },
  {
    // Specify the collection name explicitly
    collection: 'adminUsers',
  },
);

// Create and export the model
export const AdminUser = mongoose.model('AdminUser', adminUserSchema); 