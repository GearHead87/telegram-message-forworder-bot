# GramJS Integration Guide

## 🔗 Overview

The bot now supports **GramJS integration**, allowing admin users to send messages through their personal Telegram accounts instead of the bot account. This enables:

- ✅ **Reach users who haven't started the bot**
- ✅ **Send messages from your personal account**
- ✅ **Automatic fallback to bot API if needed**
- ✅ **Better delivery rates**

## 🚀 Quick Start

### 1. Setup GramJS for Admin User

1. **Get API Credentials:**
   - Go to https://my.telegram.org/apps
   - Log in with your Telegram account
   - Create a new application
   - Note down your `API ID` and `API Hash`

2. **Configure in Bot:**
   ```
   /gramjs_setup
   ```
   Follow the interactive setup process to enter your API credentials and phone number.

3. **Complete Authentication:**
   Use the bot command to complete authentication:
   ```
   /gramjs_authenticate
   ```
   Follow the interactive prompts in the bot to enter your verification code and 2FA password.

4. **Test Connection:**
   ```
   /gramjs_test
   ```

## 📋 Available Commands

### For Admin Users

| Command | Description |
|---------|-------------|
| `/gramjs_setup` | Start GramJS configuration process |
| `/gramjs_authenticate` | Complete authentication interactively |
| `/gramjs_test` | Test your GramJS connection |
| `/gramjs_status` | Check GramJS configuration status |
| `/gramjs_reset` | Reset GramJS configuration |



## 🔧 Setup Process

### Step 1: Bot Configuration
```
User: /gramjs_setup
Bot: 🔧 GramJS Setup Process

To send messages through your personal Telegram account, you need to authenticate with GramJS.

Step 1: Get API Credentials
1. Go to https://my.telegram.org/apps
2. Log in with your Telegram account
3. Create a new application
4. Copy your API ID and API Hash

Step 2: Enter API ID
Please send me your API ID (numbers only):
```

### Step 2: Enter Credentials
```
User: 123456
Bot: ✅ API ID saved!

Step 3: Enter API Hash
Please send me your API Hash (long string of letters and numbers):

User: abcdef123456789...
Bot: ✅ API Hash saved!

Step 4: Enter Phone Number
Please send me your phone number in international format (e.g., +1234567890):

User: +1234567890
Bot: ✅ Initial Setup Complete!

📱 Phone: +1234567890
🔧 API ID: 123456

Next Step: Use /gramjs_authenticate to complete the authentication process.
```

### Step 3: Complete Authentication

**Bot Authentication (Interactive)**
```
User: /gramjs_authenticate
Bot: 🔄 GramJS Authentication Process

📱 Phone: +1234567890
🔧 API ID: 123456

What will happen:
1. 📱 A verification code will be sent to your Telegram app
2. 🔐 You'll enter your 2FA password (if enabled)
3. ✅ Session will be saved securely to the database
4. 🚀 Enhanced messaging will be enabled

Important: Make sure you have access to your Telegram account on another device to receive the verification code.

Type START to begin authentication:

User: START
Bot: 📱 Verification Code Sent!

A verification code has been sent to your Telegram app (+1234567890).

Please enter the 5-digit verification code you received:

User: 12345
Bot: 🔄 Verifying code...

Bot: 🎉 GramJS Authentication Complete!

✅ Successfully authenticated as: John Doe
📱 Phone: +1234567890
📅 Authenticated: 12/28/2024

🚀 You can now use the enhanced /send command!
```

### Step 4: Verify Setup
```
/gramjs_status
```

## 📊 How It Works

### Enhanced Send Process

When an admin uses `/send`:

1. **Check GramJS Status:** Bot checks if admin has active GramJS configuration
2. **Choose Method:** 
   - 🔗 **GramJS** (if configured) - sends from personal account
   - 🤖 **Bot API** (fallback) - sends from bot account
3. **Send Messages:** Bot processes users in batches
4. **Automatic Fallback:** If GramJS fails for any user, automatically falls back to Bot API
5. **Progress Tracking:** Real-time progress updates showing method used

### Message Flow
```
Admin sends /send
├── Bot checks GramJS status
├── If GramJS active:
│   ├── Try sending via personal account
│   ├── If fails → Fallback to Bot API
│   └── Continue with next user
└── If GramJS not active:
    └── Use Bot API directly
```

## 🔒 Security & Privacy

### Data Storage
- **API Credentials:** Stored encrypted in MongoDB
- **Session Data:** Telegram session string stored securely
- **Phone Number:** Stored for reference only

### Security Measures
- ✅ Admin-only access to GramJS commands
- ✅ Secure session management
- ✅ Automatic session validation
- ✅ Error handling and logging

## 🛠️ Troubleshooting

### Common Issues

**1. "GramJS connection test failed"**
```bash
# Re-authenticate
npm run gramjs-auth
```

**2. "No GramJS configuration found"**
```
/gramjs_setup
```

**3. "Authentication error"**
- Check API credentials at https://my.telegram.org/apps
- Ensure phone number is in international format
- Verify 2FA password if enabled

**4. "Session expired"**
```
/gramjs_reset
/gramjs_setup
npm run gramjs-auth
```

### Debug Commands

```bash
# Check GramJS status
/gramjs_status

# Test connection
/gramjs_test

# Reset and start over
/gramjs_reset
```

### Logs

Check bot logs for detailed error messages:
```bash
# Development
npm run dev

# Production
docker-compose logs -f
```

## 📈 Benefits

### Before GramJS
- ❌ Can only message users who started the bot
- ❌ Messages come from bot account
- ❌ Limited by bot API restrictions

### After GramJS
- ✅ Can message any Telegram user (respecting privacy settings)
- ✅ Messages come from your personal account
- ✅ Better delivery rates
- ✅ Automatic fallback ensures reliability

## 🔄 Migration

### Existing Admins
1. Run `/gramjs_setup` to configure
2. Complete authentication with `npm run gramjs-auth`
3. Test with `/gramjs_test`
4. Continue using `/send` as normal (now enhanced!)

### New Admins
1. Add admin: `/addadmin <user_id>`
2. Admin runs `/gramjs_setup`
3. Complete authentication
4. Ready to use enhanced messaging!

## 🚨 Important Notes

1. **API Credentials:** Keep your API ID and Hash secure
2. **Phone Access:** Ensure you have access to your phone for verification
3. **2FA:** If enabled, you'll need your 2FA password
4. **Rate Limits:** GramJS respects Telegram's rate limits
5. **Privacy:** Only works with users who allow messages from your account

## 📞 Support

If you encounter issues:
1. Check this guide
2. Review bot logs
3. Try `/gramjs_reset` and reconfigure
4. Contact system administrator

---

**Note:** GramJS integration is optional. The bot continues to work normally without it, but with enhanced capabilities when configured. 