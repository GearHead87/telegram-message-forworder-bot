import { env } from './env.js';
import { Bot } from 'grammy';
import { connectDB } from './database/config.js';
import { handleSendCommand, handleSendFlow } from './commend/send.js';
import { handleStartCommand, handleHelpCommand } from './commend/basic.js';
import { requireAdmin } from './middleware/adminAuth.js';
import { 
  handleAddAdminCommand, 
  handleRemoveAdminCommand, 
  handleListAdminsCommand, 
  handleAdminHelpCommand 
} from './commend/admin.js';
import {
  handleGramjsSetupCommand,
  handleGramjsSetupFlow,
  handleGramjsAuthenticateCommand,
  handleGramjsTestCommand,
  handleGramjsStatusCommand,
  handleGramjsResetCommand
} from './commend/gramjs.js';

// Production-ready bot initialization with error handling
let bot: Bot;

try {
  // Create an instance of the `Bot` class with production configuration
  bot = new Bot(env.TELEGRAM_BOT_TOKEN, {
    // Bot configuration for production
    client: {
      timeoutSeconds: 30, // Request timeout
    },
  });

  // Error handling for the bot
  bot.catch((err) => {
    console.error('❌ Bot error occurred:', err);
    
    // Log additional context
    if (err.error) {
      console.error('Error details:', err.error);
    }
    if (err.ctx) {
      console.error('Context:', {
        update_id: err.ctx.update.update_id,
        chat_id: err.ctx.chat?.id,
        user_id: err.ctx.from?.id,
        message_id: err.ctx.msg?.message_id,
      });
    }
  });

  // Production logging middleware
  bot.use(async (ctx, next) => {
    const start = Date.now();
    
    try {
      await next();
      const duration = Date.now() - start;
      
      if (env.LOG_LEVEL === 'debug') {
        console.log(`✅ Processed update ${ctx.update.update_id} in ${duration}ms`, {
          chat_id: ctx.chat?.id,
          user_id: ctx.from?.id,
          update_type: ctx.update.message ? 'message' : 
                      ctx.update.callback_query ? 'callback_query' : 'other'
        });
      }
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`❌ Error processing update ${ctx.update.update_id} after ${duration}ms:`, error);
      throw error; // Re-throw to be handled by bot.catch()
    }
  });

  // Handle the /start command
  bot.command('start', handleStartCommand);

  // Handle the /help command
  bot.command('help', handleHelpCommand);

  // Handle the /send command (admin only)
  bot.command('send', requireAdmin, handleSendCommand);

  // Handle admin management commands (admin only)
  bot.command('addadmin', requireAdmin, handleAddAdminCommand);
  bot.command('removeadmin', requireAdmin, handleRemoveAdminCommand);
  bot.command('listadmins', requireAdmin, handleListAdminsCommand);
  bot.command('adminhelp', requireAdmin, handleAdminHelpCommand);

  // Handle gramjs commands (admin only)
  bot.command('gramjs_setup', requireAdmin, handleGramjsSetupCommand);
  bot.command('gramjs_authenticate', requireAdmin, handleGramjsAuthenticateCommand);
  bot.command('gramjs_test', requireAdmin, handleGramjsTestCommand);
  bot.command('gramjs_status', requireAdmin, handleGramjsStatusCommand);
  bot.command('gramjs_reset', requireAdmin, handleGramjsResetCommand);

  // Handle all other messages (for send flow and gramjs setup flow)
  bot.on('message', async (ctx, next) => {
    // First try gramjs setup flow
    await handleGramjsSetupFlow(ctx);
    // Then try send flow
    await handleSendFlow(ctx);
    // Continue to next handler if needed
    await next();
  });

  // Handle callback queries (for inline keyboard buttons)
  bot.on('callback_query', handleSendFlow);

  // Handle unknown commands
  bot.on('message:text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) {
      // This is an unknown command
      await ctx.reply('❓ Unknown command. Type /help to see available commands.');
      return;
    }
    await next();
  });

  console.log('✅ Bot initialized successfully');

} catch (error) {
  console.error('💥 Failed to initialize bot:', error);
  process.exit(1);
}

// Production-ready startup sequence
async function initializeBot(): Promise<void> {
  try {
    // Connect to MongoDB first
    console.log('🔌 Connecting to database...');
    await connectDB();

    // Get bot info to verify token
    console.log('🤖 Verifying bot token...');
    const botInfo = await bot.api.getMe();
    console.log(`✅ Bot verified: @${botInfo.username} (${botInfo.first_name})`);

    // Set bot commands for better UX
    await bot.api.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help information' },
      { command: 'send', description: '[Admin] Send message to all users' },
      // admin Related Commands
      { command: 'addadmin', description: '[Admin] Add a new admin' },
      { command: 'removeadmin', description: '[Admin] Remove admin access' },
      { command: 'listadmins', description: '[Admin] List all admins' },
      { command: 'adminhelp', description: '[Admin] Show admin help' },
      // gramjs Related Commands
      { command: 'gramjs_setup', description: '[Admin] Setup gramjs' },
      { command: 'gramjs_authenticate', description: '[Admin] Authenticate gramjs' },
      { command: 'gramjs_test', description: '[Admin] Test gramjs' },
      { command: 'gramjs_status', description: '[Admin] Show gramjs status' },
      { command: 'gramjs_reset', description: '[Admin] Reset gramjs' },
    ]);

    console.log('✅ Bot commands set successfully');
    console.log('🚀 Bot is ready for production!');

  } catch (error) {
    console.error('💥 Failed to initialize bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Stop the bot
    if (bot) {
      console.log('🤖 Stopping bot...');
      await bot.stop();
      console.log('✅ Bot stopped successfully');
    }

    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception in bot:', error);
  console.error('Stack:', error.stack);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection in bot at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Initialize the bot if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeBot();
}

// Export bot instance and initialization function
export { bot, initializeBot };