import { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { User } from '../database/models/User.js';
import { AdminUser } from '../database/models/AdminUser.js';
import { sendMessageContentViaGramjs, downloadFileFromTelegram, getGramjsClient, randomGroupPauseDelayMs } from '../utils/gramjsClient.js';
import { env } from '../env.js';
import { Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads.js';
import type { TelegramClient } from 'telegram';

// User state interface for send command flow
interface UserState {
  step: 'awaiting_message' | 'awaiting_confirmation';
  messageId?: number;
  chatId?: number;
  progressMessageId?: number;
  messageContent?: string; // Store the actual message content
  messageType?: 'text' | 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation' | 'video_note' | 'location' | 'contact' | 'poll' | 'other';
  mediaData?: {
    fileId?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    duration?: number;
    width?: number;
    height?: number;
    thumb?: unknown;
    caption?: string;
  };
  // Cached file buffer for reuse across all users
  fileBuffer?: Buffer;
}

// Interface for failed users with retry tracking
interface FailedUser {
  userId: string;
  triedCount: number;
}

// Rate limit configuration
const PER_SEND_DELAY_MS = 300; // wait after each send
const GROUP_SEND_COUNT = 3;    // after this many sends, pause longer
// GROUP_DELAY_MS will be randomized 10-20s via randomGroupPauseDelayMs()

// Map to store user states (supports multiple concurrent users)
const userStates = new Map<number, UserState>();

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function parseRetryAfterMs(error: unknown): number {
  const msg = typeof error === 'string' ? error : (error as any)?.message || (error as any)?.description || '';
  if (!msg) return 0;
  // Bot API: Too Many Requests: retry after X
  const botMatch = /retry after (\d+)/i.exec(msg);
  if (botMatch) return (parseInt(botMatch[1], 10) || 0) * 1000;
  // GramJS/Telegram: FLOOD_WAIT_X
  const floodMatch = /FLOOD_WAIT_(\d+)/i.exec(msg);
  if (floodMatch) return (parseInt(floodMatch[1], 10) || 0) * 1000;
  // Some gramjs errors: "A wait of X seconds is required"
  const waitMatch = /wait of (\d+) seconds/i.exec(msg);
  if (waitMatch) return (parseInt(waitMatch[1], 10) || 0) * 1000;
  return 0;
}

async function ensureClientConnected(client: TelegramClient): Promise<void> {
  if (!client.connected) {
    try {
      await client.connect();
    } catch (err) {
      console.warn('GramJS ensure connect failed, will retry later:', err);
    }
  }
}

// Helper function to download file buffer once for reuse
async function downloadFileBufferOnce(userState: UserState): Promise<void> {
  // Only download if we have media data and haven't downloaded yet
  if (userState.mediaData?.fileId && !userState.fileBuffer && env.TELEGRAM_BOT_TOKEN) {
    try {
      console.log(`📥 Downloading file buffer once for reuse: ${userState.mediaData.fileId}`);
      
      // Keep retrying until we successfully download the file
      const retryDelaysMs = [15000, 20000, 25000, 30000, 35000]; // 15s, 20s alternating
      let attemptNumber = 0;

      while (true) {
        try {
          const fileBuffer = await downloadFileFromTelegram(
            userState.mediaData.fileId,
            env.TELEGRAM_BOT_TOKEN,
            userState.mediaData.mimeType,
            userState.mediaData.fileName
          );

          if (fileBuffer) {
            userState.fileBuffer = fileBuffer;
            console.log(`✅ File buffer downloaded and cached (${fileBuffer.length} bytes)`);
            break;
          }

          const waitMs = retryDelaysMs[attemptNumber % retryDelaysMs.length];
          attemptNumber += 1;
          console.warn(`❌ Failed to download file buffer for ${userState.mediaData.fileId}. Retrying in ${Math.round(waitMs / 1000)}s (attempt #${attemptNumber})...`);
          await sleep(waitMs);
        } catch (innerErr) {
          const waitMs = retryDelaysMs[attemptNumber % retryDelaysMs.length];
          attemptNumber += 1;
          console.error(`Error downloading file buffer (attempt #${attemptNumber}):`, innerErr);
          console.warn(`⏳ Waiting ${Math.round(waitMs / 1000)}s before retrying...`);
          await sleep(waitMs);
        }
      }
    } catch (error) {
      console.error('Error downloading file buffer:', error);
    }
  }
}

// Helper function to send message using cached buffer via GramJS
async function sendMessageWithCachedBuffer(
  adminUserId: string,
  targetUserId: string,
  userState: UserState,
  client?: TelegramClient
): Promise<boolean> {
  try {
    const activeClient = client ?? (await getGramjsClient(adminUserId));
    if (!activeClient) {
      console.error(`No gramjs client available for admin ${adminUserId}`);
      return false;
    }

    // Send based on message type with cached buffer
    switch (userState.messageType) {
      case 'text':
        await activeClient.sendMessage(targetUserId, { message: userState.messageContent || '' });
        break;

      case 'photo':
        if (userState.fileBuffer) {
          // Upload and send photo using SendMedia API
          const result: Api.TypeUpdates = await activeClient.invoke(
            new Api.messages.SendMedia({
              peer: targetUserId,
              message: userState.mediaData?.caption || userState.messageContent || '',
              media: new Api.InputMediaUploadedPhoto({
                file: await activeClient.uploadFile({
                  file: new CustomFile(
                    'photo.jpg',
                    userState.fileBuffer.length,
                    "../photo.jpg",
                    userState.fileBuffer
                  ),  
                  workers: 1
                }),
              })
            })
          );
          console.log(result);
          // Send as photo with caption
          // await client.sendMessage(targetUserId, {
          //   message: userState.mediaData?.caption || userState.messageContent || '',
          //   file: userState.fileBuffer
          // });
        } else {
          // Fallback to text
          await activeClient.sendMessage(targetUserId, { 
            message: `📷 Photo: ${userState.mediaData?.caption || userState.messageContent || 'Image'}`
          });
        }
        break;

      case 'video':
        if (userState.fileBuffer) {
          await activeClient.sendMessage(targetUserId, {
            message: userState.mediaData?.caption || userState.messageContent || '',
            file: userState.fileBuffer
          });
        } else {
          await activeClient.sendMessage(targetUserId, { 
            message: `🎥 Video: ${userState.mediaData?.caption || userState.messageContent || 'Video'}`
          });
        }
        break;

      case 'document':
        if (userState.fileBuffer) {
          await activeClient.sendMessage(targetUserId, {
            message: userState.mediaData?.caption || userState.messageContent || '',
            file: userState.fileBuffer
          });
        } else {
          const fileName = userState.mediaData?.fileName || 'Document';
          await activeClient.sendMessage(targetUserId, { 
            message: `📄 ${fileName}${userState.mediaData?.caption ? '\n\n' + userState.mediaData.caption : userState.messageContent ? '\n\n' + userState.messageContent : ''}`
          });
        }
        break;

      case 'audio':
        if (userState.fileBuffer) {
          await activeClient.sendMessage(targetUserId, {
            message: userState.mediaData?.caption || userState.messageContent || '',
            file: userState.fileBuffer
          });
        } else {
          const fileName = userState.mediaData?.fileName || 'Audio';
          const duration = userState.mediaData?.duration ? ` (${Math.floor(userState.mediaData.duration / 60)}:${String(userState.mediaData.duration % 60).padStart(2, '0')})` : '';
          await activeClient.sendMessage(targetUserId, { 
            message: `🎵 ${fileName}${duration}${userState.mediaData?.caption ? '\n\n' + userState.mediaData.caption : userState.messageContent ? '\n\n' + userState.messageContent : ''}`
          });
        }
        break;

      case 'voice':
        if (userState.fileBuffer) {
          await activeClient.sendMessage(targetUserId, {
            message: userState.messageContent || '',
            file: userState.fileBuffer
          });
        } else {
          const duration = userState.mediaData?.duration ? `${Math.floor(userState.mediaData.duration / 60)}:${String(userState.mediaData.duration % 60).padStart(2, '0')}` : '';
          await activeClient.sendMessage(targetUserId, { 
            message: `🎤 Voice message${duration ? ` (${duration})` : ''}${userState.messageContent ? '\n\n' + userState.messageContent : ''}`
          });
        }
        break;

      case 'sticker':
        if (userState.fileBuffer) {
          await activeClient.sendMessage(targetUserId, {
            file: userState.fileBuffer
          });
        } else {
          await activeClient.sendMessage(targetUserId, { 
            message: userState.messageContent || '🎭 Sticker'
          });
        }
        break;

      case 'animation':
        if (userState.fileBuffer) {
          await activeClient.sendMessage(targetUserId, {
            message: userState.mediaData?.caption || userState.messageContent || '',
            file: userState.fileBuffer
          });
        } else {
          await activeClient.sendMessage(targetUserId, { 
            message: `🎬 GIF: ${userState.mediaData?.caption || userState.messageContent || 'Animation'}`
          });
        }
        break;

      case 'video_note':
        if (userState.fileBuffer) {
          await activeClient.sendMessage(targetUserId, {
            file: userState.fileBuffer
          });
        } else {
          const duration = userState.mediaData?.duration ? `${Math.floor(userState.mediaData.duration / 60)}:${String(userState.mediaData.duration % 60).padStart(2, '0')}` : '';
          await activeClient.sendMessage(targetUserId, { 
            message: `📹 Video message${duration ? ` (${duration})` : ''}`
          });
        }
        break;

      default:
        await activeClient.sendMessage(targetUserId, { 
          message: userState.messageContent || 'Media message'
        });
        break;
    }
    
    console.log(`✅ ${userState.messageType} message sent via gramjs with cached buffer from admin ${adminUserId} to ${targetUserId}`);
    return true;

  } catch (error) {
    console.error(`❌ Failed to send ${userState.messageType} message via gramjs with cached buffer from admin ${adminUserId}:`, error);
    return false;
  }
}

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

    // Extract message content and type based on message properties
    if (ctx.message.text) {
      // Plain text message
      userState.messageContent = ctx.message.text;
      userState.messageType = 'text';
    } else if (ctx.message.photo) {
      // Photo message
      userState.messageContent = ctx.message.caption || 'Photo';
      userState.messageType = 'photo';
      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get largest photo
      userState.mediaData = {
        fileId: photo.file_id,
        fileSize: photo.file_size,
        width: photo.width,
        height: photo.height,
        caption: ctx.message.caption
      };
    } else if (ctx.message.video) {
      // Video message
      userState.messageContent = ctx.message.caption || 'Video';
      userState.messageType = 'video';
      userState.mediaData = {
        fileId: ctx.message.video.file_id,
        fileName: ctx.message.video.file_name,
        mimeType: ctx.message.video.mime_type,
        fileSize: ctx.message.video.file_size,
        duration: ctx.message.video.duration,
        width: ctx.message.video.width,
        height: ctx.message.video.height,
        thumb: ctx.message.video.thumbnail,
        caption: ctx.message.caption
      };
    } else if (ctx.message.document) {
      // Document message
      userState.messageContent = ctx.message.caption || ctx.message.document.file_name || 'Document';
      userState.messageType = 'document';
      userState.mediaData = {
        fileId: ctx.message.document.file_id,
        fileName: ctx.message.document.file_name,
        mimeType: ctx.message.document.mime_type,
        fileSize: ctx.message.document.file_size,
        thumb: ctx.message.document.thumbnail,
        caption: ctx.message.caption
      };
    } else if (ctx.message.audio) {
      // Audio message
      userState.messageContent = ctx.message.caption || ctx.message.audio.title || 'Audio';
      userState.messageType = 'audio';
      userState.mediaData = {
        fileId: ctx.message.audio.file_id,
        fileName: ctx.message.audio.file_name || ctx.message.audio.title,
        mimeType: ctx.message.audio.mime_type,
        fileSize: ctx.message.audio.file_size,
        duration: ctx.message.audio.duration,
        thumb: ctx.message.audio.thumbnail,
        caption: ctx.message.caption
      };
    } else if (ctx.message.voice) {
      // Voice message
      userState.messageContent = 'Voice message';
      userState.messageType = 'voice';
      userState.mediaData = {
        fileId: ctx.message.voice.file_id,
        mimeType: ctx.message.voice.mime_type,
        fileSize: ctx.message.voice.file_size,
        duration: ctx.message.voice.duration
      };
    } else if (ctx.message.sticker) {
      // Sticker message
      userState.messageContent = ctx.message.sticker.emoji || 'Sticker';
      userState.messageType = 'sticker';
      userState.mediaData = {
        fileId: ctx.message.sticker.file_id,
        fileSize: ctx.message.sticker.file_size,
        width: ctx.message.sticker.width,
        height: ctx.message.sticker.height,
        thumb: ctx.message.sticker.thumbnail
      };
    } else if (ctx.message.animation) {
      // GIF/Animation message
      userState.messageContent = ctx.message.caption || 'GIF/Animation';
      userState.messageType = 'animation';
      userState.mediaData = {
        fileId: ctx.message.animation.file_id,
        fileName: ctx.message.animation.file_name,
        mimeType: ctx.message.animation.mime_type,
        fileSize: ctx.message.animation.file_size,
        duration: ctx.message.animation.duration,
        width: ctx.message.animation.width,
        height: ctx.message.animation.height,
        thumb: ctx.message.animation.thumbnail,
        caption: ctx.message.caption
      };
    } else if (ctx.message.video_note) {
      // Video note (circular video)
      userState.messageContent = 'Video message';
      userState.messageType = 'video_note';
      userState.mediaData = {
        fileId: ctx.message.video_note.file_id,
        fileSize: ctx.message.video_note.file_size,
        duration: ctx.message.video_note.duration,
        thumb: ctx.message.video_note.thumbnail
      };
    } else if (ctx.message.location) {
      // Location message
      userState.messageContent = `Location: ${ctx.message.location.latitude}, ${ctx.message.location.longitude}`;
      userState.messageType = 'location';
    } else if (ctx.message.contact) {
      // Contact message
      const contact = ctx.message.contact;
      userState.messageContent = `Contact: ${contact.first_name} ${contact.last_name || ''} (${contact.phone_number})`;
      userState.messageType = 'contact';
    } else if (ctx.message.poll) {
      // Poll message
      userState.messageContent = `Poll: ${ctx.message.poll.question}`;
      userState.messageType = 'poll';
    } else {
      // Unknown message type
      userState.messageContent = 'Media message';
      userState.messageType = 'other';
    }

    // Forward the message back to user for confirmation
    await ctx.api.copyMessage(ctx.chat.id, ctx.chat.id, ctx.message.message_id);

    // Create inline keyboard for confirmation
    const keyboard = new InlineKeyboard().text('✅ Yes, Send to All', 'confirm_send').text('❌ Cancel', 'cancel_send');

    const messageTypeText = userState.messageType === 'text' ? 'message' : `${userState.messageType} message`;
    await ctx.reply(`📤 This ${messageTypeText} will be sent to all users. Do you want to proceed?`, {
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

      // Inform user and start background job without awaiting to avoid webhook timeouts
      await ctx.reply('🚀 Sending started in background. Progress updates will appear here.');
      (async () => {
        try {
          await startForwardingProcess(ctx, userId, userState);
        } catch (error) {
          console.error('Error in background forwarding process:', error);
          try {
            await ctx.reply('❌ Background sending encountered an error. Check logs for details.');
          } catch {}
        }
      })();

      return; // Do not block the webhook handler
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
    // Get all users from database (only required fields), as plain objects
    const users = (await User.find().select('userId username').lean()) as Array<{ userId: string; username?: string | null }>;
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

    // Download file buffer once if we have media content
    if (userState.messageType && userState.messageType !== 'text') {
      await ctx.reply('📥 Downloading media file for distribution...');
      await downloadFileBufferOnce(userState);
    }

    // Send initial progress message
    const progressMessage = await ctx.reply(
      `🚀 Starting to send message to ${totalUsers} users...\n📊 Progress: 0/${totalUsers} (0%)\n📡 Method: ${sendMethod}`,
    );
    userState.progressMessageId = progressMessage.message_id;

    let totalSuccessCount = 0;
    let totalFailureCount = 0;
    const batchSize = 1; // process sequentially to avoid rate limits
    const delayBetweenBatches = 0; // managed by per-send/group delays
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

      // Get users to retry (when using GramJS, only retry users with username)
      const usersToRetry = users.filter(user => 
        failedUsers.some(failed => failed.userId === user.userId) && (!useGramjs || !!user.username)
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
  users: { userId: string; username?: string | null }[], 
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

  // Reuse one GramJS client for the entire run if needed
  let gramClient: TelegramClient | undefined;
  if (useGramjs && adminUserId) {
    const maybeClient = await getGramjsClient(adminUserId);
    if (maybeClient) {
      await ensureClientConnected(maybeClient as TelegramClient);
      gramClient = maybeClient as TelegramClient;
    }
  }

  // Process users in batches
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);

    // Process batch sequentially to throttle requests
    const batchResults: { success: boolean; userId: string }[] = [];
    let sendsSinceGroupPause = 0;
    for (const user of batch) {
      // When using GramJS, require a username; skip users without it
      if (useGramjs && !user.username) {
        console.log(`Skipping user ${user.userId} due to missing username for GramJS send.`);
        batchResults.push({ success: false, userId: user.userId });
        // Keep pacing consistent
        await sleep(PER_SEND_DELAY_MS);
        sendsSinceGroupPause++;
        if (sendsSinceGroupPause >= GROUP_SEND_COUNT) {
          const pauseMs = randomGroupPauseDelayMs(10000, 20000);
          console.log(`⏳ Group throttle: waiting ${Math.round(pauseMs / 1000)}s after ${GROUP_SEND_COUNT} sends`);
          await sleep(pauseMs);
          sendsSinceGroupPause = 0;
        }
        continue;
      }
      let success = false;
      try {
        if (useGramjs && adminUserId) {
          if (userState.fileBuffer) {
            if (gramClient) await ensureClientConnected(gramClient);
            try {
              const gramjsSuccess = await sendMessageWithCachedBuffer(
                adminUserId,
                user.username as string,
                userState,
                gramClient
              );
              success = gramjsSuccess;
            } catch (e) {
              // PEER_FLOOD or hard GramJS error; disable GramJS path for remainder of run
              console.error('GramJS hard error (possibly PEER_FLOOD). Falling back to Bot API for this user.', e);
              success = false;
            }
            if (!success) {
              console.log(`GramJS with cached buffer failed for user ${user.userId}, falling back to bot API`);
              try {
                await ctx.api.copyMessage(user.userId, userState.chatId!, userState.messageId!);
                success = true;
              } catch (botErr) {
                console.error(`Bot API copyMessage failed for user ${user.userId}:`, botErr);
                const waitMs = parseRetryAfterMs(botErr);
                if (waitMs > 0) {
                  console.log(`⏳ Bot API rate-limited. Waiting ${waitMs}ms before continuing...`);
                  await sleep(waitMs + 500);
                }
              }
            }
          } else if (userState.messageContent) {
            if (gramClient) await ensureClientConnected(gramClient);
            try {
              const gramjsSuccess = await sendMessageContentViaGramjs(
                adminUserId,
                user.username as string,
                userState.messageContent,
                userState.messageType || 'text'
              );
              success = gramjsSuccess;
            } catch (e) {
              console.error('GramJS hard error (possibly PEER_FLOOD). Falling back to Bot API for this user.', e);
              success = false;
            }
            if (!success) {
              console.log(`GramJS failed for user ${user.userId}, falling back to bot API`);
              try {
                await ctx.api.copyMessage(user.userId, userState.chatId!, userState.messageId!);
                success = true;
              } catch (botErr) {
                console.error(`Bot API copyMessage failed for user ${user.userId}:`, botErr);
                const waitMs = parseRetryAfterMs(botErr);
                if (waitMs > 0) {
                  console.log(`⏳ Bot API rate-limited. Waiting ${waitMs}ms before continuing...`);
                  await sleep(waitMs + 500);
                }
              }
            }
          } else {
            console.log(`No message content for GramJS, using bot API for user ${user.userId}`);
            try {
              await ctx.api.copyMessage(user.userId, userState.chatId!, userState.messageId!);
              success = true;
            } catch (botErr) {
              console.error(`Bot API copyMessage failed for user ${user.userId}:`, botErr);
              const waitMs = parseRetryAfterMs(botErr);
              if (waitMs > 0) {
                console.log(`⏳ Bot API rate-limited. Waiting ${waitMs}ms before continuing...`);
                await sleep(waitMs + 500);
              }
            }
          }
        } else {
          try {
            await ctx.api.copyMessage(user.userId, userState.chatId!, userState.messageId!);
            success = true;
          } catch (botErr) {
            console.error(`Bot API copyMessage failed for user ${user.userId}:`, botErr);
            const waitMs = parseRetryAfterMs(botErr);
            if (waitMs > 0) {
              console.log(`⏳ Bot API rate-limited. Waiting ${waitMs}ms before continuing...`);
              await sleep(waitMs + 500);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to send to user ${user.userId} (${attemptType}):`, err);
        const waitMs = parseRetryAfterMs(err);
        if (waitMs > 0) {
          console.log(`⏳ Rate-limited (GramJS). Waiting ${waitMs}ms before continuing...`);
          await sleep(waitMs + 500);
        }
      }

      batchResults.push({ success, userId: user.userId });

      // Throttle: per-send delay
      await sleep(PER_SEND_DELAY_MS);
      sendsSinceGroupPause++;
      if (sendsSinceGroupPause >= GROUP_SEND_COUNT) {
        const pauseMs = randomGroupPauseDelayMs(10000, 20000);
        console.log(`⏳ Group throttle: waiting ${Math.round(pauseMs / 1000)}s after ${GROUP_SEND_COUNT} sends`);
        await sleep(pauseMs);
        sendsSinceGroupPause = 0;
      }
    }

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
