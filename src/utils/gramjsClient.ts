import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { AdminUser } from '../database/models/AdminUser.js';

// Cache for active gramjs clients
const clientCache = new Map<string, TelegramClient>();

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

// Send message using gramjs client
export async function sendMessageViaGramjs(
  adminUserId: string, 
  targetChat: string, 
  message: string
): Promise<boolean> {
  try {
    const client = await getGramjsClient(adminUserId);
    if (!client) {
      console.error(`No gramjs client available for admin ${adminUserId}`);
      return false;
    }

    // Send the message
    await client.sendMessage(targetChat, { message });
    console.log(`✅ Message sent via gramjs from admin ${adminUserId} to ${targetChat}`);
    return true;

  } catch (error: unknown) {
    console.error(`❌ Failed to send message via gramjs from admin ${adminUserId}:`, error);
    
    // Handle specific errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('PHONE_NUMBER_BANNED')) {
      console.error('Error: Phone number might be banned by Telegram.');
    } else if (errorMessage.includes('FLOOD_WAIT')) {
      const waitTime = parseInt(errorMessage.match(/FLOOD_WAIT_(\d+)/)?.[1] || '0');
      console.error(`Error: Hit Telegram's rate limit. Need to wait for ${waitTime} seconds.`);
    } else if (errorMessage.includes('USERNAME_NOT_OCCUPIED') || errorMessage.includes('PEER_ID_INVALID')) {
      console.error('Error: The target chat username or ID might be incorrect or does not exist.');
    } else if (errorMessage.includes('USER_PRIVACY_RESTRICTED')) {
      console.error('Error: The user has privacy settings preventing messages.');
    } else if (errorMessage.includes('CHAT_WRITE_FORBIDDEN')) {
      console.error('Error: No permission to write in this chat.');
    }
    
    return false;
  }
}

// Copy message using gramjs client (for forwarding bot messages)
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

// Cleanup all cached clients (useful for graceful shutdown)
export async function disconnectAllGramjsClients(): Promise<void> {
  console.log('🔄 Disconnecting all GramJS clients...');
  const disconnectPromises = Array.from(clientCache.keys()).map(adminUserId => 
    disconnectGramjsClient(adminUserId)
  );
  await Promise.all(disconnectPromises);
  console.log('✅ All GramJS clients disconnected');
} 