import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { connectDB } from '../src/database/config.js';
import { AdminUser } from '../src/database/models/AdminUser.js';
import { input } from 'input';

// Helper script to complete GramJS authentication for admin users
async function completeGramjsAuth() {
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // Get admin user ID
    const adminUserId = await input('Enter admin user ID: ');
    
    // Find admin user
    const adminUser = await AdminUser.findOne({ 
      userId: adminUserId, 
      isActive: true,
      gramjsApiId: { $exists: true },
      gramjsApiHash: { $exists: true },
      gramjsPhoneNumber: { $exists: true }
    });

    if (!adminUser || !adminUser.gramjsApiId || !adminUser.gramjsApiHash || !adminUser.gramjsPhoneNumber) {
      console.error('❌ Admin user not found or GramJS not configured. Please run /gramjs_setup first.');
      process.exit(1);
    }

    console.log(`📱 Found admin: ${adminUser.gramjsPhoneNumber}`);
    
    if (adminUser.gramjsActive && adminUser.gramjsSession) {
      console.log('✅ GramJS is already authenticated and active!');
      process.exit(0);
    }

    // Create gramjs client
    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, adminUser.gramjsApiId, adminUser.gramjsApiHash, {
      connectionRetries: 5,
    });

    console.log('🔄 Starting authentication...');

    // Start authentication
    await client.start({
      phoneNumber: async () => adminUser.gramjsPhoneNumber!,
      password: async () => await input('Please enter your 2FA password (if enabled): '),
      phoneCode: async () => await input('Please enter the verification code you received: '),
      onError: (err: Error) => {
        console.error('❌ Authentication Error:', err.message);
      },
    });

    // Get user info to verify connection
    const me = await client.getMe();
    console.log(`✅ Successfully authenticated as: ${me.firstName} ${me.lastName || ''}`);

    // Get the session string
    const sessionString = client.session.save();
    
    // Save session to database
    await AdminUser.updateOne(
      { userId: adminUserId },
      {
        gramjsSession: sessionString,
        gramjsActive: true,
        gramjsSetupAt: new Date(),
      }
    );

    console.log('✅ Session saved to database');

    // Disconnect the client
    await client.disconnect();
    console.log('✅ Authentication completed successfully!');

    process.exit(0);

  } catch (error) {
    console.error('❌ Error during authentication:', error);
    process.exit(1);
  }
}

// Run the authentication
completeGramjsAuth(); 