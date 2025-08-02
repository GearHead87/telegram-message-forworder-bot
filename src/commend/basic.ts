import { Context } from 'grammy';

// Handle /start command
export async function handleStartCommand(ctx: Context) {
  try {
    const welcomeMessage = `🤖 Welcome to the Telegram Marketing Bot!

📝 Available Commands:
• /send - Send a message to all users
• /help - Show this help message

🔒 This bot helps you broadcast messages to all registered users safely and efficiently.`;

    await ctx.reply(welcomeMessage);
    
    console.log(`✅ New user started bot: ${ctx.from?.id} (${ctx.from?.first_name})`);
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('❌ Sorry, something went wrong. Please try again later.');
  }
}

// Handle /help command
export async function handleHelpCommand(ctx: Context) {
  try {
    const helpMessage = `🆘 Help - Telegram Marketing Bot

📋 Available Commands:
• /start - Start the bot and see welcome message
• /send - Send a message to all registered users
• /help - Show this help message

📝 How to use /send:
1. Type /send
2. Send the message you want to broadcast
3. Confirm your message
4. The bot will send it to all users

⚠️ Important Notes:
• Only private chats are supported for sending messages
• Messages are sent in batches to respect rate limits
• Failed deliveries are automatically retried
• You'll receive a detailed report after sending

🔧 For technical support, contact the administrator.`;

    await ctx.reply(helpMessage);
  } catch (error) {
    console.error('Error in help command:', error);
    await ctx.reply('❌ Sorry, something went wrong. Please try again later.');
  }
} 