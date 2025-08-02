import { Context } from 'grammy';
import { addAdmin, removeAdmin, listAdmins } from '../middleware/adminAuth.js';

// Handle /addadmin command - only super admin can add other admins
export async function handleAddAdminCommand(ctx: Context) {
  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  try {
    // Get the user ID to add as admin from the command
    const messageText = ctx.message?.text || '';
    const parts = messageText.split(' ');
    
    if (parts.length < 2) {
      await ctx.reply('❌ Usage: /addadmin <user_id>\n\nExample: /addadmin 123456789');
      return;
    }

    const newAdminUserId = parts[1];
    
    // Validate user ID format
    if (!/^\d+$/.test(newAdminUserId)) {
      await ctx.reply('❌ Invalid user ID format. User ID should be numbers only.');
      return;
    }

    // Add the admin
    const success = await addAdmin(
      newAdminUserId,
      undefined, // username - will be updated when they first interact
      undefined, // firstName - will be updated when they first interact
      undefined, // lastName - will be updated when they first interact
      userId // addedBy
    );

    if (success) {
      await ctx.reply(`✅ User ${newAdminUserId} has been added as an admin.`);
    } else {
      await ctx.reply('❌ Failed to add admin. Please try again.');
    }

  } catch (error) {
    console.error('Error in addadmin command:', error);
    await ctx.reply('❌ An error occurred while adding admin.');
  }
}

// Handle /removeadmin command - only super admin can remove other admins
export async function handleRemoveAdminCommand(ctx: Context) {
  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  try {
    // Get the user ID to remove from admin
    const messageText = ctx.message?.text || '';
    const parts = messageText.split(' ');
    
    if (parts.length < 2) {
      await ctx.reply('❌ Usage: /removeadmin <user_id>\n\nExample: /removeadmin 123456789');
      return;
    }

    const adminToRemove = parts[1];
    
    // Validate user ID format
    if (!/^\d+$/.test(adminToRemove)) {
      await ctx.reply('❌ Invalid user ID format. User ID should be numbers only.');
      return;
    }

    // Don't allow removing yourself
    if (adminToRemove === userId) {
      await ctx.reply('❌ You cannot remove yourself as admin.');
      return;
    }

    // Remove the admin
    const success = await removeAdmin(adminToRemove);

    if (success) {
      await ctx.reply(`✅ User ${adminToRemove} has been removed from admin access.`);
    } else {
      await ctx.reply('❌ Failed to remove admin or user was not an admin.');
    }

  } catch (error) {
    console.error('Error in removeadmin command:', error);
    await ctx.reply('❌ An error occurred while removing admin.');
  }
}

// Handle /listadmins command - show all active admins
export async function handleListAdminsCommand(ctx: Context) {
  try {
    const admins = await listAdmins();
    
    if (admins.length === 0) {
      await ctx.reply('📋 No active admins found.');
      return;
    }

    let message = '👥 Active Administrators:\n\n';
    
    admins.forEach((admin, index) => {
      const name = admin.firstName || admin.username || 'Unknown';
      const addedDate = new Date(admin.addedAt).toLocaleDateString();
      message += `${index + 1}. ${name}\n`;
      message += `   • User ID: ${admin.userId}\n`;
      message += `   • Added: ${addedDate}\n\n`;
    });

    await ctx.reply(message);

  } catch (error) {
    console.error('Error in listadmins command:', error);
    await ctx.reply('❌ An error occurred while fetching admin list.');
  }
}

// Handle /adminhelp command - show admin-specific help
export async function handleAdminHelpCommand(ctx: Context) {
  try {
    const helpMessage = `🔧 Admin Commands - Telegram Marketing Bot

📋 Available Admin Commands:
• /send - Send message to all users
• /addadmin <user_id> - Add a new admin
• /removeadmin <user_id> - Remove admin access
• /listadmins - List all active admins
• /adminhelp - Show this admin help

📝 How to use /send:
1. Type /send
2. Send the message you want to broadcast
3. Confirm your message
4. The bot will send it to all users

👥 Admin Management:
• Only admins can use the /send command
• Use /addadmin to grant admin access to other users
• Use /removeadmin to revoke admin access
• You cannot remove yourself as admin

⚠️ Important Notes:
• Only private chats are supported for admin commands
• Messages are sent in batches to respect rate limits
• Failed deliveries are automatically retried
• You'll receive a detailed report after sending

🔧 For technical support, contact the system administrator.`;

    await ctx.reply(helpMessage);
  } catch (error) {
    console.error('Error in adminhelp command:', error);
    await ctx.reply('❌ Sorry, something went wrong. Please try again later.');
  }
} 