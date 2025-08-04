import { Context, InlineKeyboard } from 'grammy';
import { User } from '../database/models/User.js';
import { AdminUser } from '../database/models/AdminUser.js';
import { copyMessageViaGramjs } from '../utils/gramjsClient.js';

// Types for user states
interface UserState {
  step: 'awaiting_message' | 'awaiting_confirmation';
  messageId?: number;
  chatId?: number;
  isForwarding?: boolean;
  progressMessageId?: number;
}

// Interface for failed users with retry tracking
interface FailedUser {
  userId: string;
  triedCount: number;
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

// Start the forwarding process with progress tracking and retry mechanism
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

    // Check if admin has gramjs configured
    const adminUser = await AdminUser.findOne({ 
      userId: userId.toString(), 
      isActive: true,
      gramjsActive: true,
      gramjsSession: { $exists: true, $ne: null }
    });

    const useGramjs = !!adminUser;
    const sendMethod = useGramjs ? '🔗 GramJS (Personal Account)' : '🤖 Bot API';

    // Send initial progress message
    const progressMessage = await ctx.reply(
      `🚀 Starting to send message to ${totalUsers} users...\n📊 Progress: 0/${totalUsers} (0%)\n📡 Method: ${sendMethod}`,
    );
    userState.progressMessageId = progressMessage.message_id;

    let totalSuccessCount = 0;
    let totalFailureCount = 0;
    const batchSize = 30; // Process in batches to avoid rate limits
    const delayBetweenBatches = 1000; // 1 second delay between batches
    const maxRetries = 3;

    // Array to track failed users with retry counts
    let failedUsers: FailedUser[] = [];

    // Initial send attempt
    const { successCount, failureCount, failedUserIds } = await sendToUsers(
      ctx, users, userState, batchSize, delayBetweenBatches, totalUsers, 0, 0, 'Initial', useGramjs, userId.toString()
    );

    totalSuccessCount = successCount;
    totalFailureCount = failureCount;

    // Add failed users to retry array
    failedUsers = failedUserIds.map(userId => ({ userId, triedCount: 1 }));

    // Retry failed users up to 3 times
    for (let retryAttempt = 1; retryAttempt <= maxRetries && failedUsers.length > 0; retryAttempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay before retry

      // Get users to retry
      const usersToRetry = users.filter(user => 
        failedUsers.some(failed => failed.userId === user.userId)
      );

      if (usersToRetry.length === 0) break;

      // Update progress message for retry
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          userState.progressMessageId!,
          `🔄 Retry attempt ${retryAttempt}/${maxRetries} for ${usersToRetry.length} failed users...\n📊 Current: ${totalSuccessCount} successful, ${totalFailureCount} failed`,
        );
      } catch (editError) {
        console.error('Error updating progress message:', editError);
      }

      // Retry sending to failed users
      const retryResult = await sendToUsers(
        ctx, usersToRetry, userState, batchSize, delayBetweenBatches, 
        totalUsers, totalSuccessCount, totalFailureCount, `Retry ${retryAttempt}`, useGramjs, userId.toString()
      );

      // Update counters
      const newSuccesses = retryResult.successCount - totalSuccessCount;
      const newFailures = retryResult.failureCount - totalFailureCount;
      totalSuccessCount = retryResult.successCount;
      totalFailureCount = retryResult.failureCount;

      // Update failed users array
      const stillFailedUsers: FailedUser[] = [];
      
      failedUsers.forEach(failedUser => {
        if (retryResult.failedUserIds.includes(failedUser.userId)) {
          // Still failed, increment try count
          stillFailedUsers.push({
            userId: failedUser.userId,
            triedCount: failedUser.triedCount + 1
          });
        }
        // If not in failedUserIds, it means this user succeeded in retry
      });

      failedUsers = stillFailedUsers;

      // Log retry results
      console.log(`Retry ${retryAttempt} completed: ${newSuccesses} new successes, ${newFailures} still failed`);
    }

    // Clear the failed users array after all retries
    failedUsers = [];

    // Send final completion message
    const finalSuccessRate = Math.round((totalSuccessCount / totalUsers) * 100);
    await ctx.reply(
      `✅ Message forwarding completed with retries!\n\n📊 Final Results:\n👥 Total Users: ${totalUsers}\n✅ Successfully Sent: ${totalSuccessCount}\n❌ Failed (after ${maxRetries} retries): ${totalFailureCount}\n📈 Success Rate: ${finalSuccessRate}%\n📡 Method Used: ${sendMethod}\n\n🔄 Retry Summary:\n• Failed users were retried up to ${maxRetries} times\n• All retry attempts completed`
    );

  } catch (error) {
    console.error('Error in forwarding process:', error);
    await ctx.reply('❌ Sorry, there was an error during the forwarding process.');
  } finally {
    // Clean up user state
    userStates.delete(userId);
  }
}

// Helper function to send messages to users
async function sendToUsers(
  ctx: Context, 
  users: { userId: string }[], 
  userState: UserState, 
  batchSize: number, 
  delayBetweenBatches: number,
  totalUsers: number,
  currentSuccessCount: number,
  currentFailureCount: number,
  attemptType: string,
  useGramjs: boolean = false,
  adminUserId?: string
): Promise<{ successCount: number; failureCount: number; failedUserIds: string[] }> {
  let successCount = currentSuccessCount;
  let failureCount = currentFailureCount;
  const failedUserIds: string[] = [];

  // Process users in batches
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);

    // Process batch concurrently
    const batchPromises = batch.map(async (user) => {
      try {
        if (useGramjs && adminUserId) {
          // Try to send via gramjs first
          const gramjsSuccess = await copyMessageViaGramjs(
            adminUserId,
            user.userId,
            userState.chatId!.toString(),
            userState.messageId!
          );
          
          if (gramjsSuccess) {
            return { success: true, userId: user.userId };
          } else {
            // Fallback to bot API if gramjs fails
            console.log(`GramJS failed for user ${user.userId}, falling back to bot API`);
            await ctx.api.copyMessage(user.userId, userState.chatId!, userState.messageId!);
            return { success: true, userId: user.userId };
          }
        } else {
          // Use bot API
          await ctx.api.copyMessage(user.userId, userState.chatId!, userState.messageId!);
          return { success: true, userId: user.userId };
        }
      } catch (error) {
        console.error(`Failed to send to user ${user.userId} (${attemptType}):`, error);
        return { success: false, userId: user.userId };
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
        failedUserIds.push(result.userId);
      }
    });

    const processedCount = successCount + failureCount;
    const progressPercentage = Math.round((processedCount / totalUsers) * 100);

    // Update progress every 5% or at the end of each batch
    if (progressPercentage % 5 === 0 || processedCount === totalUsers || i + batchSize >= users.length) {
      try {
        const methodText = useGramjs ? '🔗 GramJS' : '🤖 Bot API';
        await ctx.api.editMessageText(
          ctx.chat!.id,
          userState.progressMessageId!,
          `🚀 ${attemptType} sending...\n📊 Progress: ${processedCount}/${totalUsers} (${progressPercentage}%)\n✅ Successful: ${successCount}\n❌ Failed: ${failureCount}\n📡 Method: ${methodText}`,
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

  return { successCount, failureCount, failedUserIds };
}
