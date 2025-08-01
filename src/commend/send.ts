import { Context, InlineKeyboard } from 'grammy';
import { User } from '../database/models/User.js';

// Types for user states
interface UserState {
  step: 'awaiting_message' | 'awaiting_confirmation';
  messageId?: number;
  chatId?: number;
  isForwarding?: boolean;
  progressMessageId?: number;
}

// Map to store user states (supports multiple concurrent users)
const userStates = new Map<number, UserState>();

// Handle /send command
export async function handleSendCommand(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Only allow private chats
  if (ctx.chat?.type !== 'private') {
    return;
  }

  // Check if user is already in a send flow
  if (userStates.has(userId)) {
    await ctx.reply('You already have an active send process. Please complete it first.');
    return;
  }

  // Set user state to awaiting message
  userStates.set(userId, { step: 'awaiting_message' });
  await ctx.reply('📝 What message do you want to send to all users?');
}

// Handle message flow and callback queries
export async function handleSendFlow(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const userState = userStates.get(userId);
  if (!userState) return;

  // Handle callback query (button clicks)
  if (ctx.callbackQuery) {
    await handleCallbackQuery(ctx, userId, userState);
    return;
  }

  // Handle message based on current step
  if (ctx.message && userState.step === 'awaiting_message') {
    await handleMessageReceived(ctx, userId, userState);
  }
}

// Handle message received for forwarding
async function handleMessageReceived(ctx: Context, userId: number, userState: UserState) {
  if (!ctx.message || !ctx.chat) return;

  try {
    // Store message details
    userState.messageId = ctx.message.message_id;
    userState.chatId = ctx.chat.id;
    userState.step = 'awaiting_confirmation';

    // Forward the message back to user for confirmation
    await ctx.api.copyMessage(ctx.chat.id, ctx.chat.id, ctx.message.message_id);

    // Create inline keyboard for confirmation
    const keyboard = new InlineKeyboard().text('✅ Yes, Send to All', 'confirm_send').text('❌ Cancel', 'cancel_send');

    await ctx.reply('📤 This is the message that will be sent to all users. Do you want to proceed?', {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('Error handling message:', error);
    await ctx.reply('❌ Sorry, there was an error processing your message.');
    userStates.delete(userId);
  }
}

// Handle callback query (button clicks)
async function handleCallbackQuery(ctx: Context, userId: number, userState: UserState) {
  if (!ctx.callbackQuery?.data || !ctx.chat) return;

  const data = ctx.callbackQuery.data;

  try {
    await ctx.answerCallbackQuery();

    if (data === 'confirm_send') {
      if (userState.step !== 'awaiting_confirmation' || !userState.messageId || !userState.chatId) {
        await ctx.reply('❌ Invalid state. Please start over with /send');
        userStates.delete(userId);
        return;
      }

      // Start forwarding process
      userState.isForwarding = true;
      await startForwardingProcess(ctx, userId, userState);
    } else if (data === 'cancel_send') {
      await ctx.reply('❌ Send operation cancelled.');
      userStates.delete(userId);
    }
  } catch (error) {
    console.error('Error handling callback query:', error);
    await ctx.reply('❌ Sorry, there was an error processing your request.');
    userStates.delete(userId);
  }
}

// Start the forwarding process with progress tracking
async function startForwardingProcess(ctx: Context, userId: number, userState: UserState) {
  if (!userState.messageId || !userState.chatId) return;

  try {
    // Get all users from database
    const users = await User.find();
    const totalUsers = users.length;

    if (totalUsers === 0) {
      await ctx.reply('📭 No users found in the database.');
      userStates.delete(userId);
      return;
    }

    // Send initial progress message
    const progressMessage = await ctx.reply(
      `🚀 Starting to send message to ${totalUsers} users...\n📊 Progress: 0/${totalUsers} (0%)`,
    );
    userState.progressMessageId = progressMessage.message_id;

    let successCount = 0;
    let failureCount = 0;
    const batchSize = 30; // Process in batches to avoid rate limits
    const delayBetweenBatches = 1000; // 1 second delay between batches

    // Process users in batches
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      // Process batch concurrently
      const batchPromises = batch.map(async (user) => {
        try {
          await ctx.api.copyMessage(user.userId, userState.chatId!, userState.messageId!);
          return { success: true };
        } catch (error) {
          console.error(`Failed to send to user ${user.userId}:`, error);
          return { success: false };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Count successes and failures
      batchResults.forEach((result) => {
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }
      });

      const processedCount = successCount + failureCount;
      const progressPercentage = Math.round((processedCount / totalUsers) * 100);

      // Update progress every 5% or at the end of each batch
      if (progressPercentage % 5 === 0 || processedCount === totalUsers || i + batchSize >= users.length) {
        try {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            userState.progressMessageId!,
            `🚀 Sending message to users...\n📊 Progress: ${processedCount}/${totalUsers} (${progressPercentage}%)\n✅ Successful: ${successCount}\n❌ Failed: ${failureCount}`,
          );
        } catch (editError) {
          // Ignore edit errors (message might be too old)
          console.error('Error updating progress message:', editError);
        }
      }

      // Add delay between batches to respect rate limits
      if (i + batchSize < users.length) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
      }
    }

    // Send completion message
    await ctx.reply(
      `✅ Message forwarding completed!\n\n📊 Final Results:\n👥 Total Users: ${totalUsers}\n✅ Successfully Sent: ${successCount}\n❌ Failed: ${failureCount}\n📈 Success Rate: ${Math.round((successCount / totalUsers) * 100)}%`,
    );
  } catch (error) {
    console.error('Error in forwarding process:', error);
    await ctx.reply('❌ Sorry, there was an error during the forwarding process.');
  } finally {
    // Clean up user state
    userStates.delete(userId);
  }
}
