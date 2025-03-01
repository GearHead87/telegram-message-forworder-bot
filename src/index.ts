import { botToken } from './constant.js';
import { Bot } from 'grammy';
import { connectDB } from './database/config.js';
import { Chat } from './database/models/Chat.js';

// Connect to MongoDB
connectDB();

// Create an instance of the `Bot` class
const bot = new Bot(botToken);

// Create a Map to store user states
const userAwaitingMessage = new Map();

// Handle the /start command
bot.command('start', async (ctx) => {
  try {
    // Store the chat information
    const chatInfo = {
      chatId: ctx.chat.id,
      name: ctx.chat.title || `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim(),
      type: ctx.chat.type,
    };

    // Use findOneAndUpdate to either update existing chat or create new one
    await Chat.findOneAndUpdate({ chatId: chatInfo.chatId }, chatInfo, { upsert: true, new: true });

    await ctx.reply('Hi! I can only read messages that explicitly reply to me!');
  } catch (error) {
    console.error('Error saving chat:', error);
    await ctx.reply('Sorry, there was an error processing your request.');
  }
});

// Handle the /send command
bot.command('send', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  userAwaitingMessage.set(userId, true);
  await ctx.reply('Send me the message you want to publish');
});

// Handle messages globally
bot.on('message', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Check if this user is awaiting a message
  if (userAwaitingMessage.get(userId)) {
    try {
      // Get all chats from MongoDB
      const chats = await Chat.find();

      // Forward the message to all stored chats
      for (const chat of chats) {
        try {
          // Skip if this is the sender's chat
          if (chat.chatId === ctx.chat.id) continue;

          await ctx.api.copyMessage(chat.chatId, ctx.chat.id, ctx.message.message_id);
        } catch (error) {
          console.error(`Failed to send to chat ${chat.chatId}:`, error);
        }
      }

      await ctx.reply('Message has been published!');
    } catch (error) {
      console.error('Error broadcasting message:', error);
      await ctx.reply('Sorry, there was an error publishing your message.');
    }

    userAwaitingMessage.delete(userId);
  }
});

bot.start();
