import mongoose from 'mongoose';

// Define the chat schema
const chatSchema = new mongoose.Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['private', 'group', 'supergroup', 'channel'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  // Specify the collection name explicitly
  collection: 'chats'
});

// Create and export the model
export const Chat = mongoose.model('Chat', chatSchema); 