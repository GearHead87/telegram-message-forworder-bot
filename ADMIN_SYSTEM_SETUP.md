# Admin Authentication System

## 🔐 Overview

The bot now has a complete admin authentication system that prevents unauthorized users from using the `/send` command and other admin functions.

## 📋 Features

- ✅ **Database-based admin management** using `adminUsers` collection
- ✅ **Admin-only commands** protected by authentication middleware
- ✅ **Admin management commands** to add/remove admins
- ✅ **Secure authentication** checks before sensitive operations
- ✅ **Easy setup** with command-line script

## 🗄️ Database Model

### AdminUser Collection (`adminUsers`)
```javascript
{
  userId: String,        // Telegram user ID
  username: String,      // Telegram username (optional)
  firstName: String,     // First name (optional)
  lastName: String,      // Last name (optional)
  isActive: Boolean,     // Whether admin access is active
  addedAt: Date,         // When admin was added
  addedBy: String        // User ID of who added this admin
}
```

## 🚀 Setup Instructions

### 1. Add Your First Admin

```bash
# Replace 123456789 with your Telegram user ID
npm run add-admin 123456789
```

**How to get your Telegram User ID:**
1. Start a chat with [@userinfobot](https://t.me/userinfobot)
2. Send any message
3. The bot will reply with your user ID

### 2. Start the Bot

```bash
npm run dev        # Development
npm run start      # Production
```

### 3. Test Admin Access

1. Send `/start` to your bot
2. Send `/adminhelp` to see admin commands
3. Try `/send` to test broadcasting (admin only)

## 📋 Admin Commands

### For All Users
- `/start` - Start the bot
- `/help` - Show general help

### For Admins Only
- `/send` - Send message to all users
- `/addadmin <user_id>` - Add a new admin
- `/removeadmin <user_id>` - Remove admin access
- `/listadmins` - List all active admins
- `/adminhelp` - Show admin-specific help

## 🔧 Admin Management

### Adding New Admins
```
/addadmin 987654321
```

### Removing Admins
```
/removeadmin 987654321
```

### Listing All Admins
```
/listadmins
```

## 🛡️ Security Features

1. **Authentication Middleware**: All admin commands are protected
2. **Database Validation**: Admin status is verified against database
3. **Active Status Check**: Only active admins can use commands
4. **Self-Protection**: Admins cannot remove themselves
5. **Access Logging**: Admin access is logged for security

## 🔍 How It Works

### Authentication Flow
```
User sends /send → requireAdmin middleware → Check database → Allow/Deny
```

### Middleware Protection
```javascript
bot.command('send', requireAdmin, handleSendCommand);
```

### Database Check
```javascript
const adminUser = await AdminUser.findOne({ 
  userId: userId, 
  isActive: true 
});
```

## 📝 Example Usage

### 1. Regular User (Non-Admin)
```
User: /send
Bot: 🚫 Access denied. You are not authorized to use this command.
```

### 2. Admin User
```
Admin: /send
Bot: 📝 What message do you want to send to all users?
```

### 3. Adding New Admin
```
Admin: /addadmin 555666777
Bot: ✅ User 555666777 has been added as an admin.
```

## 🚨 Important Notes

1. **First Admin**: Use the `npm run add-admin` script to add your first admin
2. **User IDs**: Always use Telegram user IDs (numbers), not usernames
3. **Private Chats Only**: Admin commands only work in private chats
4. **Database Required**: Make sure MongoDB is connected
5. **Backup Admins**: Always have multiple admins to avoid lockout

## 🔧 Troubleshooting

### "Access denied" for admin user
1. Check if user ID is correct
2. Verify user is in `adminUsers` collection
3. Ensure `isActive: true` in database

### Cannot add first admin
1. Check database connection
2. Verify MongoDB is running
3. Check environment variables

### Admin commands not working
1. Ensure bot is running latest code
2. Check middleware is applied to commands
3. Verify database connection

## 📊 Monitoring

### View Admin Activity
```bash
# Check logs for admin access
tail -f logs/bot.log | grep "Admin access"
```

### Database Queries
```javascript
// List all admins
db.adminUsers.find({ isActive: true })

// Check specific user
db.adminUsers.findOne({ userId: "123456789" })
```

This admin system provides secure, database-backed authentication for your Telegram marketing bot! 🎉 