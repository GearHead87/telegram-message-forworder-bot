import { env } from './env.js';
import { Bot } from 'grammy';
import { connectDB } from './database/config.js';
import { handleSendCommand, handleSendFlow } from './commend/send.js';

// Connect to MongoDB
connectDB();

// Create an instance of the `Bot` class and export it
export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// Handle the /send command
bot.command('send', handleSendCommand);

// Handle all other messages (for send flow)
bot.on('message', handleSendFlow);

// Handle callback queries (for inline keyboard buttons)
bot.on('callback_query', handleSendFlow);