import { Context, NextFunction } from 'grammy';
import { AdminUser } from '../database/models/AdminUser.js';

// Middleware to check if user is an admin
export async function requireAdmin(ctx: Context, next: NextFunction) {
  const userId = ctx.from?.id?.toString();
  
  if (!userId) {
    await ctx.reply('❌ Unable to verify your identity. Please try again.');
    return;
  }

  try {
    // Check if user exists in admin collection and is active
    const adminUser = await AdminUser.findOne({ 
      userId: userId, 
      isActive: true 
    });

    if (!adminUser) {
      await ctx.reply('🚫 Access denied. You are not authorized to use this command.\n\nOnly administrators can use this bot. Contact the system administrator if you believe this is an error.');
      return;
    }

    // User is admin, continue to next handler
    console.log(`✅ Admin access granted: ${userId} (${ctx.from?.first_name})`);
    await next();
    
  } catch (error) {
    console.error('Error checking admin status:', error);
    await ctx.reply('❌ Authentication error. Please try again later.');
  }
}

// Helper function to check if user is admin (without middleware)
export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const adminUser = await AdminUser.findOne({ 
      userId: userId, 
      isActive: true 
    });
    return !!adminUser;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// Helper function to add a new admin
export async function addAdmin(
  userId: string, 
  username?: string, 
  firstName?: string, 
  lastName?: string,
  addedBy?: string
): Promise<boolean> {
  try {
    await AdminUser.findOneAndUpdate(
      { userId },
      {
        userId,
        username,
        firstName,
        lastName,
        isActive: true,
        addedBy,
        addedAt: new Date(),
      },
      { upsert: true, new: true }
    );
    
    console.log(`✅ Admin added: ${userId} (${firstName || username || 'Unknown'})`);
    return true;
  } catch (error) {
    console.error('Error adding admin:', error);
    return false;
  }
}

// Helper function to remove admin access
export async function removeAdmin(userId: string): Promise<boolean> {
  try {
    const result = await AdminUser.findOneAndUpdate(
      { userId },
      { isActive: false },
      { new: true }
    );
    
    if (result) {
      console.log(`✅ Admin access revoked: ${userId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error removing admin:', error);
    return false;
  }
}

// Helper function to list all active admins
export async function listAdmins() {
  try {
    const admins = await AdminUser.find({ isActive: true }).select('-_id -__v');
    return admins;
  } catch (error) {
    console.error('Error listing admins:', error);
    return [];
  }
} 