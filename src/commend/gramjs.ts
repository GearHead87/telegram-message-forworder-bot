import { Context, InlineKeyboard } from 'grammy';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { AdminUser } from '../database/models/AdminUser.js';
import { testGramjsConnection } from '../utils/gramjsClient.js';
import {env} from "../env.js"
import { isAdmin } from '../middleware/adminAuth.js';
import { User } from '../database/models/User.js';
import bigInt from 'big-integer';

// Use configured SERVER_URL or fall back to localhost with PORT
const SERVER_BASE_URL = env.SERVER_URL ?? `http://localhost:${env.PORT}`;

// Interface for OTP response data
interface OTPResponseData {
  submitted: boolean;
  otp: string | null;
  type: 'code' | 'password';
}

// Interface for session creation response
interface SessionResponseData {
  sessionId: string;
  url: string;
}

// Map to store user states during gramjs setup
interface GramjsSetupState {
  step: 'awaiting_api_id' | 'awaiting_api_hash' | 'awaiting_phone' | 'setup_complete';
  apiId?: number;
  apiHash?: string;
  phoneNumber?: string;
}

// Map to store user states during gramjs authentication
interface GramjsAuthState {
  step: 'awaiting_start' | 'awaiting_code' | 'awaiting_password' | 'completed';
  client?: TelegramClient;
  adminUser?: {
    userId: string;
    gramjsApiId: number;
    gramjsApiHash: string;
    gramjsPhoneNumber: string;
  };
  codeResolve?: (code: string) => void;
  passwordResolve?: (password: string) => void;
  sessionId?: string; // Added for secure OTP session
}

const setupStates = new Map<number, GramjsSetupState>();
const authStates = new Map<number, GramjsAuthState>();

// Handle /gramjs_setup command - start gramjs setup process
export async function handleGramjsSetupCommand(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // Check if user already has gramjs configured
    const adminUser = await AdminUser.findOne({ 
      userId: userId.toString(), 
      isActive: true,
      gramjsActive: true 
    });

    if (adminUser) {
      await ctx.reply(`🔗 You already have GramJS configured and active!\n\n📱 Phone: ${adminUser.gramjsPhoneNumber}\n📅 Setup Date: ${adminUser.gramjsSetupAt?.toLocaleDateString()}\n\nUse /gramjs_test to test your connection or /gramjs_reset to reconfigure.`);
      return;
    }

    // Start setup process
    setupStates.set(userId, { step: 'awaiting_api_id' });

    const setupMessage = `🔧 **GramJS Setup Process**

To send messages through your personal Telegram account, you need to authenticate with GramJS.

**Step 1: Get API Credentials**
1. Go to https://my.telegram.org/apps
2. Log in with your Telegram account
3. Create a new application
4. Copy your **API ID** and **API Hash**

**Step 2: Enter API ID**
Please send me your **API ID** (numbers only):

⚠️ **Important:** Your API credentials will be stored securely and used only for sending messages through your account.

Type /cancel to cancel this setup.`;

    await ctx.reply(setupMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in gramjs setup command:', error);
    await ctx.reply('❌ An error occurred while starting GramJS setup.');
    setupStates.delete(userId);
  }
}

// Handle gramjs setup and authentication flows
export async function handleGramjsSetupFlow(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const messageText = ctx.message?.text?.trim();
  if (!messageText) return;

  // Check for setup flow first
  const setupState = setupStates.get(userId);
  if (setupState) {
    await handleSetupFlow(ctx, userId, setupState, messageText);
    return;
  }

  // Check for authentication flow
  const authState = authStates.get(userId);
  if (authState) {
    await handleAuthFlow(ctx, userId, authState, messageText);
    return;
  }
}

// Handle setup flow specifically
async function handleSetupFlow(ctx: Context, userId: number, setupState: GramjsSetupState, messageText: string) {
  // Handle cancel command
  if (messageText.toLowerCase() === '/cancel') {
    setupStates.delete(userId);
    await ctx.reply('❌ GramJS setup cancelled.');
    return;
  }

  try {
    switch (setupState.step) {
      case 'awaiting_api_id':
        await handleApiIdStep(ctx, userId, setupState, messageText);
        break;
      case 'awaiting_api_hash':
        await handleApiHashStep(ctx, userId, setupState, messageText);
        break;
      case 'awaiting_phone':
        await handlePhoneStep(ctx, userId, setupState, messageText);
        break;
    }
  } catch (error) {
    console.error('Error in gramjs setup flow:', error);
    await ctx.reply('❌ An error occurred during setup. Please try again with /gramjs_setup');
    setupStates.delete(userId);
  }
}

// Handle authentication flow specifically
async function handleAuthFlow(ctx: Context, userId: number, authState: GramjsAuthState, messageText: string) {
  // Handle cancel command
  if (messageText.toLowerCase() === '/cancel') {
    if (authState.client) {
      await authState.client.disconnect();
    }
    authStates.delete(userId);
    await ctx.reply('❌ GramJS authentication cancelled.');
    return;
  }

  try {
    switch (authState.step) {
      case 'awaiting_start':
        await handleAuthStartStep(ctx, userId, authState, messageText);
        break;
      case 'awaiting_code':
        await handleAuthCodeStep(ctx, userId, authState, messageText);
        break;
      case 'awaiting_password':
        await handleAuthPasswordStep(ctx, userId, authState, messageText);
        break;
    }
  } catch (error) {
    console.error('Error in gramjs auth flow:', error);
    await ctx.reply('❌ An error occurred during authentication. Please try again with /gramjs_authenticate');
    if (authState.client) {
      await authState.client.disconnect();
    }
    authStates.delete(userId);
  }
}

// Handle API ID step
async function handleApiIdStep(ctx: Context, userId: number, userState: GramjsSetupState, messageText: string) {
  const apiId = parseInt(messageText);
  
  if (isNaN(apiId) || apiId <= 0) {
    await ctx.reply('❌ Invalid API ID. Please enter a valid number (e.g., 123456):');
    return;
  }

  userState.apiId = apiId;
  userState.step = 'awaiting_api_hash';
  
  await ctx.reply('✅ API ID saved!\n\n**Step 3: Enter API Hash**\nPlease send me your **API Hash** (long string of letters and numbers):');
}

// Handle API Hash step
async function handleApiHashStep(ctx: Context, userId: number, userState: GramjsSetupState, messageText: string) {
  if (!messageText || messageText.length < 10) {
    await ctx.reply('❌ Invalid API Hash. Please enter a valid API Hash (long string of letters and numbers):');
    return;
  }

  userState.apiHash = messageText;
  userState.step = 'awaiting_phone';
  
  await ctx.reply('✅ API Hash saved!\n\n**Step 4: Enter Phone Number**\nPlease send me your phone number in international format (e.g., +1234567890):');
}

// Handle phone number step and complete setup
async function handlePhoneStep(ctx: Context, userId: number, userState: GramjsSetupState, messageText: string) {
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  
  if (!phoneRegex.test(messageText)) {
    await ctx.reply('❌ Invalid phone number format. Please enter your phone number in international format (e.g., +1234567890):');
    return;
  }

  userState.phoneNumber = messageText;
  
  try {
    await ctx.reply('🔄 Setting up GramJS authentication...\n\n⚠️ **Next Steps:**\n1. The system will now save your credentials\n2. Use /gramjs_authenticate to complete the authentication process\n3. You will need to enter verification codes when prompted');

    // Save initial configuration to database (without session)
    await AdminUser.updateOne(
      { userId: userId.toString() },
      {
        gramjsApiId: userState.apiId,
        gramjsApiHash: userState.apiHash,
        gramjsPhoneNumber: userState.phoneNumber,
        gramjsSetupAt: new Date(),
        gramjsActive: false, // Not active until authentication is complete
      }
    );

    // Clean up state
    setupStates.delete(userId);

    await ctx.reply(`✅ **Initial Setup Complete!**

📱 Phone: ${userState.phoneNumber}
🔧 API ID: ${userState.apiId}

**Next Step:** Use /gramjs_authenticate to complete the authentication process.

**Note:** You will need to enter verification codes during authentication.`);

  } catch (error) {
    console.error('Error in phone step:', error);
    await ctx.reply('❌ Failed to save configuration. Please try again.');
    setupStates.delete(userId);
  }
}

// Handle /gramjs_authenticate command - complete authentication
export async function handleGramjsAuthenticateCommand(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // Get admin user data
    const adminUser = await AdminUser.findOne({ 
      userId: userId.toString(), 
      isActive: true,
      gramjsApiId: { $exists: true },
      gramjsApiHash: { $exists: true },
      gramjsPhoneNumber: { $exists: true }
    });

    if (!adminUser || !adminUser.gramjsApiId || !adminUser.gramjsApiHash || !adminUser.gramjsPhoneNumber) {
      await ctx.reply('❌ No GramJS configuration found. Please run /gramjs_setup first.');
      return;
    }

    if (adminUser.gramjsActive) {
      await ctx.reply('✅ GramJS is already authenticated and active!');
      return;
    }

    // Set up authentication state
    authStates.set(userId, { 
      step: 'awaiting_start',
      adminUser: {
        userId: adminUser.userId,
        gramjsApiId: adminUser.gramjsApiId!,
        gramjsApiHash: adminUser.gramjsApiHash!,
        gramjsPhoneNumber: adminUser.gramjsPhoneNumber!,
      }
    });

    await ctx.reply(`🔄 **GramJS Authentication Process**

📱 Phone: ${adminUser.gramjsPhoneNumber}
🔧 API ID: ${adminUser.gramjsApiId}

**What will happen:**
1. 📱 A verification code will be sent to your Telegram app
2. 🔐 You'll enter your 2FA password (if enabled)
3. ✅ Session will be saved securely to the database
4. 🚀 Enhanced messaging will be enabled

**Important:** Make sure you have access to your Telegram account on another device to receive the verification code.

Type **START** to begin authentication:

Type **/cancel** to cancel this process.`);

  } catch (error) {
    console.error('Error in gramjs authenticate command:', error);
    await ctx.reply('❌ An error occurred while starting authentication.');
  }
}

// Handle authentication start step
async function handleAuthStartStep(ctx: Context, userId: number, authState: GramjsAuthState, messageText: string) {
  if (messageText.toUpperCase() !== 'START') {
    await ctx.reply('Please type **START** to begin authentication or **/cancel** to cancel.');
    return;
  }

  if (!authState.adminUser) {
    await ctx.reply('❌ Authentication data not found. Please try /gramjs_authenticate again.');
    authStates.delete(userId);
    return;
  }

  try {
    await ctx.reply('🔄 Connecting to Telegram and sending verification code...');

    // Create gramjs client
    const stringSession = new StringSession('');
    const client = new TelegramClient(
      stringSession, 
      authState.adminUser.gramjsApiId, 
      authState.adminUser.gramjsApiHash, 
      {
        connectionRetries: 5,
      }
    );

    authState.client = client;

    // Start authentication in the background (non-blocking)
    const authPromise = client.start({
      phoneNumber: async () => {
        return authState.adminUser!.gramjsPhoneNumber;
      },
      password: async () => {
        // Create secure OTP session for 2FA password
        try {
          const sessionResponse = await fetch(`${SERVER_BASE_URL}/api/create-otp-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId.toString(), type: 'password' })
          });
          
          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json() as SessionResponseData;
            authState.sessionId = sessionData.sessionId;
            
            await ctx.reply(`🔐 **Two-Factor Authentication Required**

Your account has 2FA enabled for additional security.

🔐 **For your security, please enter your 2FA password through our secure web form:**

🌐 **Link:** ${SERVER_BASE_URL}${sessionData.url}

**Steps:**
1. 🔒 Open the link above in your browser
2. 🔑 Enter your 2FA password
3. ✅ Submit the form
4. 💬 Come back here and type "confirm"

⚠️ **Important:** This protects your 2FA password from being intercepted.`);
          } else {
            await ctx.reply('❌ Failed to create secure session. Please try again.');
          }
        } catch (error) {
          console.error('Error creating 2FA session:', error);
          await ctx.reply('❌ Failed to create secure session. Please try again.');
        }
        
        authState.step = 'awaiting_password';
        
        // Return a promise that will be resolved when user confirms password submission
        return new Promise<string>((resolve) => {
          authState.passwordResolve = resolve;
        });
      },
      phoneCode: async () => {
        // Create secure OTP session for verification code
        try {
          const sessionResponse = await fetch(`${SERVER_BASE_URL}/api/create-otp-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId.toString(), type: 'code' })
          });
          
          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json() as SessionResponseData;
            authState.sessionId = sessionData.sessionId;
            
            await ctx.reply(`📱 **Verification Code Sent!**

A verification code has been sent to your Telegram app (${authState.adminUser!.gramjsPhoneNumber}).

🔐 **For your security, please enter the code through our secure web form:**

🌐 **Link:** ${SERVER_BASE_URL}${sessionData.url}

**Steps:**
1. 📱 Open the link above in your browser
2. 🔢 Enter the 5-digit verification code you received
3. ✅ Submit the form
4. 💬 Come back here and type "confirm"

⚠️ **Important:** This protects you from code interception attacks.`);
          } else {
            await ctx.reply('❌ Failed to create secure session. Please try again.');
          }
        } catch (error) {
          console.error('Error creating OTP session:', error);
          await ctx.reply('❌ Failed to create secure session. Please try again.');
        }
        
        authState.step = 'awaiting_code';
        
        // Return a promise that will be resolved when user confirms OTP submission
        return new Promise<string>((resolve) => {
          authState.codeResolve = resolve;
        });
      },
      onError: (err: Error) => {
        console.error('❌ GramJS Authentication Error:', err.message);
        ctx.reply(`❌ Authentication error: ${err.message}`);
      },
    });

    // Handle the authentication result asynchronously
    authPromise.then(async () => {
      // If we reach here, authentication was successful
      await completeAuthentication(ctx, userId, authState);
    }).catch(async (error) => {
      console.error('Error during authentication:', error);
      await ctx.reply('❌ Authentication failed. Please try again with /gramjs_authenticate');
      if (authState.client) {
        await authState.client.disconnect();
      }
      authStates.delete(userId);
    });

    // Don't await the auth promise - let it run in background

  } catch (error: unknown) {
    console.error('Error starting authentication:', error);
    await ctx.reply('❌ Failed to start authentication. Please check your configuration and try again.');
    if (authState.client) {
      await authState.client.disconnect();
    }
    authStates.delete(userId);
  }
}

// Handle authentication code step
async function handleAuthCodeStep(ctx: Context, userId: number, authState: GramjsAuthState, messageText: string) {
  // Check if user typed "confirm" to check for submitted OTP
  if (messageText.toLowerCase() === 'confirm') {
    if (!authState.client || !authState.adminUser) {
      await ctx.reply('❌ Authentication session expired. Please try /gramjs_authenticate again.');
      authStates.delete(userId);
      return;
    }

    try {
      // Check if OTP was submitted through web interface
      const response = await fetch(`${SERVER_BASE_URL}/api/otp-status/${authState.sessionId}`);
      if (!response.ok) {
        await ctx.reply('❌ No OTP session found. Please use the web link provided earlier.');
        return;
      }

      const otpData = await response.json() as OTPResponseData;
      if (!otpData.submitted) {
        await ctx.reply('❌ No verification code submitted yet. Please enter your code in the web form first, then type "confirm" here.');
        return;
      }

      await ctx.reply('🔄 Verifying code...');

      // Use the submitted OTP
      const codeResolve = authState.codeResolve;
      if (codeResolve && otpData.otp) {
        codeResolve(otpData.otp);
        authState.codeResolve = undefined;
      }

    } catch (error: unknown) {
      console.error('Error handling verification code:', error);
      await ctx.reply('❌ Error verifying code. Please try again by typing "confirm".');
    }
    return;
  }

  // If not "confirm", provide instructions
  if (!authState.sessionId) {
    await ctx.reply('❌ No secure session found. Please restart the authentication process.');
    return;
  }

  await ctx.reply(`🔐 **Secure Code Entry Required**

To protect your account, please enter your verification code through the secure web form:

🌐 **Link:** ${SERVER_BASE_URL}/otp/${authState.sessionId}

**Steps:**
1. 📱 Open the link above in your browser
2. 🔢 Enter the 5-digit verification code you received
3. ✅ Submit the form
4. 💬 Come back here and type "confirm"

⚠️ **Security:** Never share your verification codes in Telegram messages.`);
}

// Handle authentication password step (2FA)
async function handleAuthPasswordStep(ctx: Context, userId: number, authState: GramjsAuthState, messageText: string) {
  // Check if user typed "confirm" to check for submitted password
  if (messageText.toLowerCase() === 'confirm') {
    if (!authState.client || !authState.adminUser) {
      await ctx.reply('❌ Authentication session expired. Please try /gramjs_authenticate again.');
      authStates.delete(userId);
      return;
    }

    try {
      // Check if password was submitted through web interface
      const response = await fetch(`${SERVER_BASE_URL}/api/otp-status/${authState.sessionId}`);
      if (!response.ok) {
        await ctx.reply('❌ No OTP session found. Please use the web link provided earlier.');
        return;
      }

      const otpData = await response.json() as OTPResponseData;
      if (!otpData.submitted) {
        await ctx.reply('❌ No 2FA password submitted yet. Please enter your password in the web form first, then type "confirm" here.');
        return;
      }

      await ctx.reply('🔄 Verifying 2FA password...');

      // Use the submitted password
      const passwordResolve = authState.passwordResolve;
      if (passwordResolve && otpData.otp) {
        passwordResolve(otpData.otp);
        authState.passwordResolve = undefined;
      }

    } catch (error: unknown) {
      console.error('Error handling 2FA password:', error);
      await ctx.reply('❌ Error verifying password. Please try again by typing "confirm".');
    }
    return;
  }

  // If not "confirm", provide instructions
  if (!authState.sessionId) {
    await ctx.reply('❌ No secure session found. Please restart the authentication process.');
    return;
  }

  await ctx.reply(`🔐 **Secure 2FA Password Entry Required**

To protect your account, please enter your 2FA password through the secure web form:

🌐 **Link:** ${SERVER_BASE_URL}/otp/${authState.sessionId}

**Steps:**
1. 🔒 Open the link above in your browser
2. 🔑 Enter your 2FA password
3. ✅ Submit the form
4. 💬 Come back here and type "confirm"

⚠️ **Security:** Never share your 2FA password in Telegram messages.`);
}

// Complete the authentication process
async function completeAuthentication(ctx: Context, userId: number, authState: GramjsAuthState) {
  try {
    if (!authState.client || !authState.adminUser) {
      throw new Error('Missing authentication data');
    }

    // Get user info to verify connection
    const me = await authState.client.getMe();
    console.log(`✅ GramJS authentication successful for admin ${userId}. Connected as: ${me.firstName}`);

    // Get the session string
    const sessionString = authState.client.session.save();
    
    // Save session to database
    await AdminUser.updateOne(
      { userId: authState.adminUser.userId },
      {
        gramjsSession: sessionString,
        gramjsActive: true,
        gramjsSetupAt: new Date(),
      }
    );

    // Disconnect the setup client
    await authState.client.disconnect();

    // Clean up state
    authStates.delete(userId);

    await ctx.reply(`🎉 **GramJS Authentication Complete!**

✅ Successfully authenticated as: **${me.firstName} ${me.lastName || ''}**
📱 Phone: ${authState.adminUser.gramjsPhoneNumber}
📅 Authenticated: ${new Date().toLocaleDateString()}

🚀 You can now use the enhanced /send command to send messages through your personal account!

**Available Commands:**
• /gramjs_test - Test your GramJS connection
• /gramjs_status - Check your GramJS status
• /send - Send messages (now enhanced with GramJS!)

**Note:** Your session data is stored securely and will be used only for sending messages through the bot.`);

  } catch (error) {
    console.error('Error completing gramjs authentication:', error);
    await ctx.reply('❌ Failed to complete authentication. Please try again with /gramjs_authenticate');
    if (authState.client) {
      await authState.client.disconnect();
    }
    authStates.delete(userId);
  }
}

// Handle /gramjs_test command
export async function handleGramjsTestCommand(ctx: Context) {
  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  try {
    await ctx.reply('🔄 Testing GramJS connection...');
    
    const isConnected = await testGramjsConnection(userId);
    
    if (isConnected) {
      await ctx.reply('✅ GramJS connection test successful! Your session is working properly.');
    } else {
      await ctx.reply('❌ GramJS connection test failed. Please run /gramjs_setup to reconfigure.');
    }

  } catch (error) {
    console.error('Error in gramjs test command:', error);
    await ctx.reply('❌ An error occurred while testing GramJS connection.');
  }
}

// Handle /gramjs_status command
export async function handleGramjsStatusCommand(ctx: Context) {
  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  try {
    const adminUser = await AdminUser.findOne({ 
      userId: userId, 
      isActive: true 
    });

    if (!adminUser) {
      await ctx.reply('❌ Admin user not found.');
      return;
    }

    let statusMessage = '📊 **GramJS Status**\n\n';

    if (adminUser.gramjsActive && adminUser.gramjsSession) {
      statusMessage += `✅ **Status:** Active and Authenticated\n`;
      statusMessage += `📱 **Phone:** ${adminUser.gramjsPhoneNumber}\n`;
      statusMessage += `📅 **Setup Date:** ${adminUser.gramjsSetupAt?.toLocaleDateString()}\n`;
      statusMessage += `🔧 **API ID:** ${adminUser.gramjsApiId}\n\n`;
      statusMessage += `**Available Commands:**\n`;
      statusMessage += `• /gramjs_test - Test connection\n`;
      statusMessage += `• /gramjs_reset - Reset configuration`;
    } else if (adminUser.gramjsApiId && adminUser.gramjsApiHash) {
      statusMessage += `⚠️ **Status:** Configured but not authenticated\n`;
      statusMessage += `📱 **Phone:** ${adminUser.gramjsPhoneNumber}\n`;
      statusMessage += `📅 **Setup Date:** ${adminUser.gramjsSetupAt?.toLocaleDateString()}\n\n`;
      statusMessage += `Use /gramjs_authenticate to complete authentication.`;
    } else {
      statusMessage += `❌ **Status:** Not configured\n\n`;
      statusMessage += `Use /gramjs_setup to configure GramJS for enhanced messaging capabilities.`;
    }

    await ctx.reply(statusMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in gramjs status command:', error);
    await ctx.reply('❌ An error occurred while checking GramJS status.');
  }
}

// Handle /gramjs_reset command
export async function handleGramjsResetCommand(ctx: Context) {
  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  try {
    // Clear gramjs data from database
    await AdminUser.updateOne(
      { userId: userId },
      {
        $unset: {
          gramjsSession: 1,
          gramjsApiId: 1,
          gramjsApiHash: 1,
          gramjsPhoneNumber: 1,
          gramjsSetupAt: 1,
        },
        gramjsActive: false,
      }
    );

    // Clear any ongoing setup state
    setupStates.delete(parseInt(userId));

    await ctx.reply('🔄 GramJS configuration has been reset.\n\nUse /gramjs_setup to configure it again.');

  } catch (error) {
    console.error('Error in gramjs reset command:', error);
    await ctx.reply('❌ An error occurred while resetting GramJS configuration.');
  }
}

// =========================
// /add-group-member feature
// =========================

const CB_PREFIX_SELECT_DIALOG = 'agm_select_';
const CB_PREFIX_PAGE = 'agm_page_';
const GROUPS_PAGE_SIZE = 20;

function truncateForButton(text: string, maxCodePoints: number = 28): string {
  try {
    const cleaned = (text || '')
      .replace(/[\u0000-\u001F\u007F]/g, '') // remove control chars
      .trim();
    const cps = Array.from(cleaned);
    if (cps.length === 0) return 'Untitled';
    if (cps.length <= maxCodePoints) return cps.join('');
    const head = cps.slice(0, Math.max(1, maxCodePoints - 1)).join('');
    return head + '…';
  } catch {
    return 'Untitled';
  }
}

function buildGroupsKeyboard(
  groups: { id: string; title: string }[],
  page: number,
  pageSize: number
): { keyboard: InlineKeyboard; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(groups.length, start + pageSize);
  const slice = groups.slice(start, end);

  const kb = new InlineKeyboard();
  let col = 0;
  for (const g of slice) {
    const data = CB_PREFIX_SELECT_DIALOG + g.id;
    const label = truncateForButton(g.title, 28);
    kb.text(label, data);
    col += 1;
    if (col % 2 === 0) kb.row();
  }

  // Pagination row
  kb.row();
  if (currentPage > 1) {
    kb.text('⬅️ Previous', CB_PREFIX_PAGE + String(currentPage - 1));
  }
  if (currentPage < totalPages) {
    if (currentPage > 1) {
      kb.text('Next ➡️', CB_PREFIX_PAGE + String(currentPage + 1));
    } else {
      // keep alignment, still place only Next if no Prev
      kb.text('Next ➡️', CB_PREFIX_PAGE + String(currentPage + 1));
    }
  }

  return { keyboard: kb, totalPages };
}

// List available groups/channels via inline buttons
export async function handleAddGroupMemberCommand(ctx: Context) {
  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  // Only admins
  const allowed = await isAdmin(userId);
  if (!allowed) {
    await ctx.reply('❌ You are not authorized to use this command.');
    return;
  }

  try {
    const client = await (await import('../utils/gramjsClient.js')).getGramjsClient(userId);
    if (!client) {
      await ctx.reply('❌ GramJS is not configured. Run /gramjs_setup and authenticate first.');
      return;
    }
    if (!client.connected) {
      try { await client.connect(); } catch {}
    }

    await ctx.reply('🔎 Fetching your groups...');

    const dialogs = await client.invoke(new Api.messages.GetDialogs({ offsetPeer: new Api.InputPeerSelf(), limit: 200 }));
    const chats = (dialogs as any).chats as Api.TypeChat[];

    const groups: { id: string; title: string }[] = [];
    for (const chat of chats) {
      if (chat instanceof Api.Channel) {
        // Prefer megagroups (supergroups). Include channels as well if needed.
        const title = (chat as any).title || (chat as any).username || 'Unnamed';
        groups.push({ id: String(chat.id), title });
      } else if (chat instanceof Api.Chat) {
        const title = (chat as any).title || 'Group';
        groups.push({ id: String(chat.id), title });
      }
    }

    if (groups.length === 0) {
      await ctx.reply('📭 No groups found in your account.');
      return;
    }

    const { keyboard, totalPages } = buildGroupsKeyboard(groups, 1, GROUPS_PAGE_SIZE);
    await ctx.reply(
      totalPages > 1
        ? `👥 Select a group/channel to export members (Page 1/${totalPages}):`
        : '👥 Select a group/channel to export members:',
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error handling /add-group-member:', error);
    await ctx.reply('❌ Failed to fetch groups. Please try again later.');
  }
}

// Handle callback: export selected group's members
export async function handleAddGroupMemberCallback(ctx: Context) {
  const userId = ctx.from?.id?.toString();
  const data = ctx.callbackQuery?.data;
  if (!userId || !data) return;

  // Pagination handling
  if (data.startsWith(CB_PREFIX_PAGE)) {
    const pageStr = data.slice(CB_PREFIX_PAGE.length);
    const requestedPage = parseInt(pageStr, 10) || 1;
    await ctx.answerCallbackQuery();

    try {
      const client = await (await import('../utils/gramjsClient.js')).getGramjsClient(userId);
      if (!client) return;
      if (!client.connected) { try { await client.connect(); } catch {} }

      const dialogs = await client.invoke(new Api.messages.GetDialogs({ offsetPeer: new Api.InputPeerSelf(), limit: 200 }));
      const chats = (dialogs as any).chats as Api.TypeChat[];
      const groups: { id: string; title: string }[] = [];
      for (const chat of chats) {
        if (chat instanceof Api.Channel) {
          const title = (chat as any).title || (chat as any).username || 'Unnamed';
          groups.push({ id: String(chat.id), title });
        } else if (chat instanceof Api.Chat) {
          const title = (chat as any).title || 'Group';
          groups.push({ id: String(chat.id), title });
        }
      }

      const { keyboard, totalPages } = buildGroupsKeyboard(groups, requestedPage, GROUPS_PAGE_SIZE);

      const chatId = ctx.chat?.id;
      const messageId = ctx.callbackQuery?.message?.message_id;
      if (!chatId || !messageId) {
        // If we can't edit, just acknowledge and return
        await ctx.answerCallbackQuery();
        return;
      }
      const text = totalPages > 1
        ? `👥 Select a group/channel to export members (Page ${Math.min(Math.max(1, requestedPage), Math.max(1, totalPages))}/${totalPages}):`
        : '👥 Select a group/channel to export members:';

      // Edit the original message
      await ctx.api.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
    } catch (err) {
      console.error('Error handling pagination:', err);
    }
    return;
  }

  if (!data.startsWith(CB_PREFIX_SELECT_DIALOG)) return; // Not ours

  const allowed = await isAdmin(userId);
  if (!allowed) return;

  const dialogId = data.slice(CB_PREFIX_SELECT_DIALOG.length);
  await ctx.answerCallbackQuery();

  try {
    const client = await (await import('../utils/gramjsClient.js')).getGramjsClient(userId);
    if (!client) {
      await ctx.reply('❌ GramJS is not configured. Run /gramjs_setup and authenticate first.');
      return;
    }
    if (!client.connected) {
      try { await client.connect(); } catch {}
    }

    // Resolve input entity from dialogs to get correct accessHash for channels
    const dialogs = await client.invoke(new Api.messages.GetDialogs({ offsetPeer: new Api.InputPeerSelf(), limit: 200 }));
    const chats = (dialogs as any).chats as Api.TypeChat[];
    let inputEntity: Api.TypeInputPeer | null = null;
    let groupName = 'Selected chat';
    for (const chat of chats) {
      if ((chat as any).id && String((chat as any).id) === dialogId) {
        if (chat instanceof Api.Channel) {
          inputEntity = new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash! });
          groupName = chat.title;
        } else if (chat instanceof Api.Chat) {
          inputEntity = new Api.InputPeerChat({ chatId: chat.id });
          groupName = chat.title;
        }
        break;
      }
    }

    if (!inputEntity) {
      await ctx.reply('❌ Failed to resolve the selected chat.');
      return;
    }

    interface ExportedMember { userId: string; username?: string; firstName?: string; lastName?: string }
    const members: ExportedMember[] = [];

    // For channels/supergroups, use channels.GetParticipants; for basic chats, use messages.GetFullChat
    if (inputEntity instanceof Api.InputPeerChannel) {
      let offset = 0;
      const limit = 200;
      while (true) {
        const res = await client.invoke(new Api.channels.GetParticipants({
          channel: inputEntity,
          filter: new Api.ChannelParticipantsRecent(),
          offset,
          limit,
          hash: bigInt.zero as any,
        }));
        const users = (res as any).users as Api.User[];
        if (users && users.length > 0) {
          for (const u of users) {
            if (!(u instanceof Api.User)) continue;
            members.push({
              userId: String(u.id),
              username: u.username || undefined,
              firstName: u.firstName || undefined,
              lastName: u.lastName || undefined,
            });
          }
        }
        const count = users?.length || 0;
        offset += count;
        if (count < limit) break;
      }
    } else if (inputEntity instanceof Api.InputPeerChat) {
      // messages.GetFullChat expects int (number) for small chat IDs in MTProto schema; keep as-is
      const res = await client.invoke(new Api.messages.GetFullChat({ chatId: (inputEntity as Api.InputPeerChat).chatId as any }));
      const users = (res as any).users as Api.User[];
      if (users) {
        for (const u of users) {
          if (!(u instanceof Api.User)) continue;
          members.push({
            userId: String(u.id),
            username: u.username || undefined,
            firstName: u.firstName || undefined,
            lastName: u.lastName || undefined,
          });
        }
      }
    }

    await ctx.reply(`👤 Total members found: ${members.length}`);

    // Deduplicate by userId
    const seen = new Set<string>();
    const uniqueMembers = members.filter(m => {
      if (seen.has(m.userId)) return false;
      seen.add(m.userId);
      return true;
    });

    // Prepare bulk upserts into MongoDB User collection
    const ops = uniqueMembers.map((m) => {
      const setDoc: Record<string, unknown> = { source: groupName };
      if (m.username) setDoc.username = m.username;
      return {
        updateOne: {
          filter: { userId: m.userId },
          update: { $set: setDoc, $setOnInsert: { userId: m.userId } },
          upsert: true,
        },
      } as const;
    });

    if (ops.length > 0) {
      const result = await (User as any).bulkWrite(ops, { ordered: false });
      const upserts = result?.upsertedCount ?? 0;
      const modified = result?.modifiedCount ?? 0;
      await ctx.reply(`💾 Members saved to database for "${groupName}". Added: ${upserts}, Updated: ${modified}.`);
    } else {
      await ctx.reply('ℹ️ No members to save.');
    }
  } catch (error) {
    console.error('Error exporting group members:', error);
    await ctx.reply('❌ Failed to save members to database.');
  }
}