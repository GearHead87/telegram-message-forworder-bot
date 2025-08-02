#!/usr/bin/env tsx

import { connectDB } from '../src/database/config.js';
import { addAdmin } from '../src/middleware/adminAuth.js';

// Script to add the first admin user
async function addFirstAdmin() {
  try {
    console.log('🔌 Connecting to database...');
    await connectDB();

    // Get user ID from command line arguments
    const userId = process.argv[2];
    
    if (!userId) {
      console.error('❌ Usage: npm run add-admin <user_id>');
      console.error('Example: npm run add-admin 123456789');
      process.exit(1);
    }

    // Validate user ID format
    if (!/^\d+$/.test(userId)) {
      console.error('❌ Invalid user ID format. User ID should be numbers only.');
      process.exit(1);
    }

    console.log(`🔧 Adding user ${userId} as admin...`);

    const success = await addAdmin(
      userId,
      undefined, // username - will be updated when they first interact
      undefined, // firstName - will be updated when they first interact
      undefined, // lastName - will be updated when they first interact
      'system' // addedBy
    );

    if (success) {
      console.log(`✅ User ${userId} has been added as admin successfully!`);
      console.log('');
      console.log('📝 Next steps:');
      console.log('1. Start your bot');
      console.log('2. Send /start to your bot from the admin account');
      console.log('3. Use /adminhelp to see available admin commands');
      console.log('4. Use /addadmin <user_id> to add more admins');
    } else {
      console.error('❌ Failed to add admin. Please check the database connection.');
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Error adding admin:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the script
addFirstAdmin(); 