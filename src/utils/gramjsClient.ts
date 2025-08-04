import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { AdminUser } from '../database/models/AdminUser.js';

// Cache for active gramjs clients
const clientCache = new Map<string, TelegramClient>();

// Cache for downloaded files to avoid re-downloading
interface CachedFile {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
  downloadedAt: number;
}

const fileCache = new Map<string, CachedFile>();

// Cache expiry time (1 hour)
const CACHE_EXPIRY_MS = 60 * 60 * 1000;

// Interface for gramjs client configuration
export interface GramjsConfig {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString?: string;
}

// Create or get existing gramjs client for an admin user
export async function getGramjsClient(adminUserId: string): Promise<TelegramClient | null> {
  try {
    // Check if client is already cached and connected
    const cachedClient = clientCache.get(adminUserId);
    if (cachedClient && cachedClient.connected) {
      return cachedClient;
    }

    // Get admin user data from database
    const adminUser = await AdminUser.findOne({ 
      userId: adminUserId, 
      isActive: true,
      gramjsActive: true,
      gramjsSession: { $exists: true, $ne: null },
      gramjsApiId: { $exists: true, $ne: null },
      gramjsApiHash: { $exists: true, $ne: null }
    });

    if (!adminUser || !adminUser.gramjsSession || !adminUser.gramjsApiId || !adminUser.gramjsApiHash) {
      console.log(`No valid gramjs configuration found for admin ${adminUserId}`);
      return null;
    }

    // Create new client with stored session
    const stringSession = new StringSession(adminUser.gramjsSession);
    const client = new TelegramClient(stringSession, adminUser.gramjsApiId, adminUser.gramjsApiHash, {
      connectionRetries: 3,
    });

    // Connect the client
    await client.connect();
    
    // Verify the session is still valid
    try {
      await client.getMe();
      console.log(`✅ GramJS client connected for admin ${adminUserId}`);
      
      // Cache the client
      clientCache.set(adminUserId, client);
      return client;
    } catch (error) {
      console.error(`❌ GramJS session invalid for admin ${adminUserId}:`, error);
      
      // Mark session as inactive in database
      await AdminUser.updateOne(
        { userId: adminUserId },
        { gramjsActive: false }
      );
      
      await client.disconnect();
      return null;
    }

  } catch (error) {
    console.error(`Error creating gramjs client for admin ${adminUserId}:`, error);
    return null;
  }
}

// Helper function to check if cached file is still valid
function isCacheValid(cachedFile: CachedFile): boolean {
  return Date.now() - cachedFile.downloadedAt < CACHE_EXPIRY_MS;
}

// Helper function to download file from Telegram using file_id (via Bot API) with caching
async function downloadFileFromTelegram(fileId: string, botToken: string, mimeType?: string, fileName?: string): Promise<Buffer | null> {
  try {
    // Check if file is already cached and valid
    const cachedFile = fileCache.get(fileId);
    if (cachedFile && isCacheValid(cachedFile)) {
      console.log(`📁 Using cached file for ${fileId}`);
      return cachedFile.buffer;
    }

    // Import node-fetch dynamically to handle both Node.js versions
    let fetchFunction: (input: string, init?: any) => Promise<any>;
    try {
      // Try to use built-in fetch (Node 18+)
      if (typeof globalThis.fetch !== 'undefined') {
        fetchFunction = globalThis.fetch;
      } else {
        // Fall back to node-fetch for older Node versions
        const nodeFetch = await import('node-fetch');
        fetchFunction = nodeFetch.default;
      }
    } catch (error) {
      console.error('Failed to import fetch:', error);
      return null;
    }

    // Get file info from Bot API
    const fileInfoResponse = await fetchFunction(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileInfoData = await fileInfoResponse.json() as { ok: boolean; result: { file_path: string } };
    
    if (!fileInfoData.ok) {
      console.error('Failed to get file info:', fileInfoData);
      return null;
    }

    const filePath = fileInfoData.result.file_path;
    
    // Download the file
    const fileResponse = await fetchFunction(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!fileResponse.ok) {
      console.error('Failed to download file:', fileResponse.status, fileResponse.statusText);
      return null;
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    
    // Cache the downloaded file
    fileCache.set(fileId, {
      buffer: fileBuffer,
      mimeType,
      fileName,
      downloadedAt: Date.now()
    });

    console.log(`📥 Downloaded and cached file ${fileId} (${fileBuffer.length} bytes)`);
    return fileBuffer;
  } catch (error) {
    console.error('Error downloading file:', error);
    return null;
  }
}

// Send message content using gramjs client (supports all message types with actual media)
export async function sendMessageContentViaGramjs(
  adminUserId: string,
  targetChat: string,
  messageContent: string,
  messageType: 'text' | 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation' | 'video_note' | 'location' | 'contact' | 'poll' | 'other' = 'text',
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
  },
  botToken?: string
): Promise<boolean> {
  try {
    const client = await getGramjsClient(adminUserId);
    if (!client) {
      console.error(`No gramjs client available for admin ${adminUserId}`);
      return false;
    }

    // Send based on message type
    switch (messageType) {
      case 'text':
        await client.sendMessage(targetChat, { message: messageContent });
        break;

      case 'photo':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(
              mediaData.fileId, 
              botToken, 
              'image/jpeg', 
              'photo.jpg'
            );
            if (fileBuffer) {
              // Send as photo - GramJS will automatically detect it as a photo based on content
              await client.sendMessage(targetChat, {
                message: mediaData.caption || messageContent || '',
                file: fileBuffer
              });
            } else {
              // Fallback to text if download fails
              await client.sendMessage(targetChat, { 
                message: `📷 Photo: ${mediaData.caption || messageContent || 'Image'}`
              });
            }
          } catch (error) {
            console.error('Error sending photo:', error);
            await client.sendMessage(targetChat, { 
              message: `📷 Photo: ${mediaData.caption || messageContent || 'Image'}`
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: `📷 Photo: ${messageContent || 'Image'}`
          });
        }
        break;

      case 'video':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(
              mediaData.fileId, 
              botToken, 
              mediaData.mimeType || 'video/mp4', 
              mediaData.fileName || 'video.mp4'
            );
            if (fileBuffer) {
              await client.sendMessage(targetChat, {
                message: mediaData.caption || messageContent || '',
                file: fileBuffer
              });
            } else {
              await client.sendMessage(targetChat, { 
                message: `🎥 Video: ${mediaData.caption || messageContent || 'Video'}`
              });
            }
          } catch (error) {
            console.error('Error sending video:', error);
            await client.sendMessage(targetChat, { 
              message: `🎥 Video: ${mediaData.caption || messageContent || 'Video'}`
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: `🎥 Video: ${messageContent || 'Video'}`
          });
        }
        break;

      case 'document':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(
              mediaData.fileId, 
              botToken, 
              mediaData.mimeType, 
              mediaData.fileName
            );
            if (fileBuffer) {
              await client.sendMessage(targetChat, {
                message: mediaData.caption || messageContent || '',
                file: fileBuffer
              });
            } else {
              const fileName = mediaData.fileName || 'Document';
              await client.sendMessage(targetChat, { 
                message: `📄 ${fileName}${mediaData.caption ? '\n\n' + mediaData.caption : messageContent ? '\n\n' + messageContent : ''}`
              });
            }
          } catch (error) {
            console.error('Error sending document:', error);
            const fileName = mediaData.fileName || 'Document';
            await client.sendMessage(targetChat, { 
              message: `📄 ${fileName}${mediaData.caption ? '\n\n' + mediaData.caption : messageContent ? '\n\n' + messageContent : ''}`
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: `📄 Document: ${messageContent || 'File'}`
          });
        }
        break;

      case 'audio':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(
              mediaData.fileId, 
              botToken, 
              mediaData.mimeType, 
              mediaData.fileName
            );
            if (fileBuffer) {
              await client.sendMessage(targetChat, {
                message: mediaData.caption || messageContent || '',
                file: fileBuffer
              });
            } else {
              const fileName = mediaData.fileName || 'Audio';
              const duration = mediaData.duration ? ` (${Math.floor(mediaData.duration / 60)}:${String(mediaData.duration % 60).padStart(2, '0')})` : '';
              await client.sendMessage(targetChat, { 
                message: `🎵 ${fileName}${duration}${mediaData.caption ? '\n\n' + mediaData.caption : messageContent ? '\n\n' + messageContent : ''}`
              });
            }
          } catch (error) {
            console.error('Error sending audio:', error);
            const fileName = mediaData.fileName || 'Audio';
            const duration = mediaData.duration ? ` (${Math.floor(mediaData.duration / 60)}:${String(mediaData.duration % 60).padStart(2, '0')})` : '';
            await client.sendMessage(targetChat, { 
              message: `🎵 ${fileName}${duration}${mediaData.caption ? '\n\n' + mediaData.caption : messageContent ? '\n\n' + messageContent : ''}`
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: `🎵 Audio: ${messageContent || 'Audio file'}`
          });
        }
        break;

      case 'voice':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(mediaData.fileId, botToken);
            if (fileBuffer) {
              await client.sendMessage(targetChat, {
                message: messageContent || '',
                file: fileBuffer
              });
            } else {
              const duration = mediaData.duration ? `${Math.floor(mediaData.duration / 60)}:${String(mediaData.duration % 60).padStart(2, '0')}` : '';
              await client.sendMessage(targetChat, { 
                message: `🎤 Voice message${duration ? ` (${duration})` : ''}${messageContent ? '\n\n' + messageContent : ''}`
              });
            }
          } catch (error) {
            console.error('Error sending voice:', error);
            const duration = mediaData.duration ? `${Math.floor(mediaData.duration / 60)}:${String(mediaData.duration % 60).padStart(2, '0')}` : '';
            await client.sendMessage(targetChat, { 
              message: `🎤 Voice message${duration ? ` (${duration})` : ''}${messageContent ? '\n\n' + messageContent : ''}`
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: `🎤 Voice message: ${messageContent || 'Voice note'}`
          });
        }
        break;

      case 'sticker':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(mediaData.fileId, botToken);
            if (fileBuffer) {
              await client.sendMessage(targetChat, {
                file: fileBuffer
              });
            } else {
              await client.sendMessage(targetChat, { 
                message: messageContent || '🎭 Sticker'
              });
            }
          } catch (error) {
            console.error('Error sending sticker:', error);
            await client.sendMessage(targetChat, { 
              message: messageContent || '🎭 Sticker'
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: messageContent || '🎭 Sticker'
          });
        }
        break;

      case 'animation':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(mediaData.fileId, botToken);
            if (fileBuffer) {
              await client.sendMessage(targetChat, {
                message: mediaData.caption || messageContent || '',
                file: fileBuffer
              });
            } else {
              await client.sendMessage(targetChat, { 
                message: `🎬 GIF: ${mediaData.caption || messageContent || 'Animation'}`
              });
            }
          } catch (error) {
            console.error('Error sending animation:', error);
            await client.sendMessage(targetChat, { 
              message: `🎬 GIF: ${mediaData.caption || messageContent || 'Animation'}`
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: `🎬 Animation: ${messageContent || 'GIF'}`
          });
        }
        break;

      case 'video_note':
        if (mediaData?.fileId && botToken) {
          try {
            const fileBuffer = await downloadFileFromTelegram(mediaData.fileId, botToken);
            if (fileBuffer) {
              await client.sendMessage(targetChat, {
                file: fileBuffer
              });
            } else {
              const duration = mediaData.duration ? `${Math.floor(mediaData.duration / 60)}:${String(mediaData.duration % 60).padStart(2, '0')}` : '';
              await client.sendMessage(targetChat, { 
                message: `📹 Video message${duration ? ` (${duration})` : ''}`
              });
            }
          } catch (error) {
            console.error('Error sending video note:', error);
            const duration = mediaData.duration ? `${Math.floor(mediaData.duration / 60)}:${String(mediaData.duration % 60).padStart(2, '0')}` : '';
            await client.sendMessage(targetChat, { 
              message: `📹 Video message${duration ? ` (${duration})` : ''}`
            });
          }
        } else {
          await client.sendMessage(targetChat, { 
            message: `📹 Video message: ${messageContent || 'Video note'}`
          });
        }
        break;

      case 'location':
        // For location, send as text message (actual location sharing requires more complex implementation)
        await client.sendMessage(targetChat, { 
          message: messageContent || '📍 Location shared'
        });
        break;

      case 'contact':
        await client.sendMessage(targetChat, { 
          message: messageContent || '👤 Contact shared'
        });
        break;

      case 'poll':
        await client.sendMessage(targetChat, { 
          message: messageContent || '📊 Poll shared'
        });
        break;

      default:
        await client.sendMessage(targetChat, { 
          message: messageContent || 'Media message'
        });
        break;
    }
    
    console.log(`✅ ${messageType} message sent via gramjs from admin ${adminUserId} to ${targetChat}`);
    return true;

  } catch (error) {
    console.error(`❌ Failed to send ${messageType} message via gramjs from admin ${adminUserId}:`, error);
    return false;
  }
}

// Copy message using gramjs client (for forwarding bot messages) - DEPRECATED
export async function copyMessageViaGramjs(
  adminUserId: string,
  targetChat: string,
  fromChatId: string,
  messageId: number
): Promise<boolean> {
  try {
    const client = await getGramjsClient(adminUserId);
    if (!client) {
      console.error(`No gramjs client available for admin ${adminUserId}`);
      return false;
    }

    // Forward/copy the message
    await client.forwardMessages(targetChat, {
      messages: [messageId],
      fromPeer: fromChatId,
    });
    
    console.log(`✅ Message copied via gramjs from admin ${adminUserId} to ${targetChat}`);
    return true;

  } catch (error) {
    console.error(`❌ Failed to copy message via gramjs from admin ${adminUserId}:`, error);
    return false;
  }
}

// Test gramjs connection for an admin
export async function testGramjsConnection(adminUserId: string): Promise<boolean> {
  try {
    const client = await getGramjsClient(adminUserId);
    if (!client) {
      return false;
    }

    // Try to get user info to test connection
    const me = await client.getMe();
    console.log(`✅ GramJS connection test successful for admin ${adminUserId}. Connected as: ${me.firstName}`);
    return true;

  } catch (error) {
    console.error(`❌ GramJS connection test failed for admin ${adminUserId}:`, error);
    return false;
  }
}

// Disconnect and cleanup gramjs client
export async function disconnectGramjsClient(adminUserId: string): Promise<void> {
  try {
    const client = clientCache.get(adminUserId);
    if (client) {
      await client.disconnect();
      clientCache.delete(adminUserId);
      console.log(`✅ GramJS client disconnected for admin ${adminUserId}`);
    }
  } catch (error) {
    console.error(`Error disconnecting gramjs client for admin ${adminUserId}:`, error);
  }
}

// Clean up expired files from cache
export function cleanupFileCache(): void {
  for (const [fileId, cachedFile] of fileCache.entries()) {
    if (!isCacheValid(cachedFile)) {
      fileCache.delete(fileId);
      console.log(`🗑️ Removed expired cached file: ${fileId}`);
    }
  }
}

// Get cache statistics
export function getFileCacheStats(): { totalFiles: number; totalSize: number } {
  let totalSize = 0;
  for (const cachedFile of fileCache.values()) {
    totalSize += cachedFile.buffer.length;
  }
  return {
    totalFiles: fileCache.size,
    totalSize
  };
}

// Cleanup all cached clients (useful for graceful shutdown)
export async function disconnectAllGramjsClients(): Promise<void> {
  console.log('🔄 Disconnecting all GramJS clients...');
  const disconnectPromises = Array.from(clientCache.keys()).map(adminUserId => 
    disconnectGramjsClient(adminUserId)
  );
  await Promise.all(disconnectPromises);
  
  // Also cleanup file cache
  fileCache.clear();
  console.log('✅ All GramJS clients disconnected and file cache cleared');
} 