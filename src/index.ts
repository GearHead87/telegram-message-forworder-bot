import { botToken } from './constant.js';
import { Bot } from 'grammy';
import fs from 'fs/promises';
import path from 'path';

const CHAT_ID_FILE = path.join(process.cwd(), 'src', 'database', 'chatId.json');

// Interface for our chat storage
interface ChatInfo {
  id: number;
  name: string;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

// Function to load existing chats
async function loadChats(): Promise<ChatInfo[]> {
  try {
    const data = await fs.readFile(CHAT_ID_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Function to save chats
async function saveChats(chats: ChatInfo[]) {
  await fs.writeFile(CHAT_ID_FILE, JSON.stringify(chats, null, 2));
}

console.log(botToken);

// Create an instance of the `Bot` class
const bot = new Bot(botToken);

// Create a Map to store user states
const userAwaitingMessage = new Map();

// Handle the /start command
bot.command('start', async (ctx) => {
  // Store the chat information
  const chats = await loadChats();
  const chatInfo: ChatInfo = {
    id: ctx.chat.id,
    name: ctx.chat.title || `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim(),
    type: ctx.chat.type,
  };

  // Check if chat is not already stored
  if (!chats.some((chat) => chat.id === chatInfo.id)) {
    chats.push(chatInfo);
    await saveChats(chats);
  }

  await ctx.reply('Hi! I can only read messages that explicitly reply to me!');
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
      // Get stored chats
      const chats = await loadChats();

      // Forward the message to all stored chats
      for (const chat of chats) {
        try {
          await ctx.api.copyMessage(chat.id, ctx.chat.id, ctx.message.message_id);
        } catch (error) {
          console.error(`Failed to send to chat ${chat.id}:`, error);
        }
      }

      await ctx.reply('Message has been published to all chats!');
    } catch (error) {
      console.error('Error broadcasting message:', error);
      await ctx.reply('Sorry, there was an error publishing your message.');
    }

    userAwaitingMessage.delete(userId);
  }
});

bot.start();
