import express from 'express';
import { webhookCallback } from 'grammy';
import { bot, initializeBot } from './index.js';

// Create Express app
const app = express();

// Middleware to parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Temporary storage for OTP sessions (in production, use Redis or database)
interface OTPSession {
  userId: string;
  type: 'code' | 'password';
  timestamp: number;
  otp?: string;
  confirmed?: boolean;
}

const otpSessions = new Map<string, OTPSession>();

// Clean up expired sessions (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of otpSessions.entries()) {
    if (now - session.timestamp > 10 * 60 * 1000) { // 10 minutes
      otpSessions.delete(sessionId);
    }
  }
}, 60000); // Clean every minute

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// OTP input form endpoint
app.get('/otp/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = otpSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).send(`
      <html>
        <head>
          <title>Session Not Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; text-align: center; }
            .error { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h2 class="error">❌ Session Not Found</h2>
          <p>This OTP session has expired or doesn't exist.</p>
          <p>Please try the authentication process again from your Telegram bot.</p>
        </body>
      </html>
    `);
  }

  const isPassword = session.type === 'password';
  const title = isPassword ? 'Enter 2FA Password' : 'Enter Verification Code';
  const placeholder = isPassword ? 'Your 2FA Password' : '12345';
  const inputType = isPassword ? 'password' : 'text';
  const maxLength = isPassword ? '' : 'maxlength="5"';
  const pattern = isPassword ? '' : 'pattern="[0-9]{5}"';

  res.send(`
    <html>
      <head>
        <title>${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            max-width: 400px; 
            margin: 50px auto; 
            padding: 20px; 
            background: #f8f9fa;
          }
          .container { 
            background: white; 
            padding: 30px; 
            border-radius: 10px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h2 { color: #2c3e50; text-align: center; margin-bottom: 20px; }
          .form-group { margin-bottom: 20px; }
          label { display: block; margin-bottom: 8px; font-weight: bold; color: #34495e; }
          input { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #ddd; 
            border-radius: 5px; 
            font-size: 16px; 
            box-sizing: border-box;
          }
          input:focus { border-color: #3498db; outline: none; }
          button { 
            width: 100%; 
            padding: 12px; 
            background: #3498db; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            font-size: 16px; 
            cursor: pointer;
          }
          button:hover { background: #2980b9; }
          .info { 
            background: #e8f4fd; 
            padding: 15px; 
            border-radius: 5px; 
            margin-bottom: 20px; 
            border-left: 4px solid #3498db;
          }
          .warning {
            background: #fef9e7;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #f39c12;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>🔐 ${title}</h2>
          
          ${!isPassword ? `
            <div class="info">
              📱 A verification code has been sent to your Telegram app. Enter the 5-digit code below.
            </div>
          ` : `
            <div class="info">
              🔒 Two-factor authentication is enabled on your account. Please enter your 2FA password.
            </div>
          `}
          
          <div class="warning">
            ⚠️ <strong>Security Notice:</strong> This is a secure, one-time form. Never share your verification codes or passwords with anyone.
          </div>

          <form method="POST" action="/otp/${sessionId}">
            <div class="form-group">
              <label for="otp">${isPassword ? '2FA Password:' : 'Verification Code:'}</label>
              <input 
                type="${inputType}" 
                id="otp" 
                name="otp" 
                placeholder="${placeholder}"
                ${maxLength}
                ${pattern}
                required
                autocomplete="off"
                ${isPassword ? '' : 'inputmode="numeric"'}
              >
            </div>
            <button type="submit">Submit ${isPassword ? 'Password' : 'Code'}</button>
          </form>
          
          <p style="text-align: center; margin-top: 20px; font-size: 14px; color: #7f8c8d;">
            This session will expire in 10 minutes for security.
          </p>
        </div>
      </body>
    </html>
  `);
});

// Handle OTP submission
app.post('/otp/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { otp } = req.body;
  const session = otpSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).send(`
      <html>
        <head>
          <title>Session Expired</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; text-align: center; }
            .error { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h2 class="error">❌ Session Expired</h2>
          <p>This session has expired. Please restart the authentication process from your Telegram bot.</p>
        </body>
      </html>
    `);
  }

  if (!otp || otp.trim() === '') {
    return res.status(400).send(`
      <html>
        <head>
          <title>Invalid Input</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; text-align: center; }
            .error { color: #e74c3c; }
            a { color: #3498db; text-decoration: none; }
          </style>
        </head>
        <body>
          <h2 class="error">❌ Invalid Input</h2>
          <p>Please enter a valid ${session.type === 'password' ? '2FA password' : 'verification code'}.</p>
          <a href="/otp/${sessionId}">← Go Back</a>
        </body>
      </html>
    `);
  }

  // Validate code format (only for verification codes)
  if (session.type === 'code' && !/^\d{5}$/.test(otp.trim())) {
    return res.status(400).send(`
      <html>
        <head>
          <title>Invalid Code Format</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; text-align: center; }
            .error { color: #e74c3c; }
            a { color: #3498db; text-decoration: none; }
          </style>
        </head>
        <body>
          <h2 class="error">❌ Invalid Code Format</h2>
          <p>Please enter a valid 5-digit verification code (e.g., 12345).</p>
          <a href="/otp/${sessionId}">← Go Back</a>
        </body>
      </html>
    `);
  }

  // Store the OTP
  session.otp = otp.trim();
  session.confirmed = true;
  session.timestamp = Date.now(); // Update timestamp

  res.send(`
    <html>
      <head>
        <title>Success</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            max-width: 400px; 
            margin: 50px auto; 
            padding: 20px; 
            text-align: center;
            background: #f8f9fa;
          }
          .container { 
            background: white; 
            padding: 30px; 
            border-radius: 10px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .success { color: #27ae60; }
          .info { 
            background: #e8f5e8; 
            padding: 15px; 
            border-radius: 5px; 
            margin: 20px 0;
            border-left: 4px solid #27ae60;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2 class="success">✅ ${session.type === 'password' ? 'Password' : 'Code'} Submitted Successfully</h2>
          <div class="info">
            Your ${session.type === 'password' ? '2FA password' : 'verification code'} has been securely submitted and is being processed.
          </div>
          <p><strong>Next Steps:</strong></p>
          <p>Go back to your Telegram bot. The authentication process will continue automatically.</p>
          <p style="font-size: 14px; color: #7f8c8d; margin-top: 30px;">
            You can safely close this page now.
          </p>
        </div>
      </body>
    </html>
  `);
});

// API endpoint to check if OTP is submitted (used by bot)
app.get('/api/otp-status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = otpSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    submitted: !!session.confirmed,
    otp: session.confirmed ? session.otp : null,
    type: session.type
  });
});

// Create OTP session (used by bot)
app.post('/api/create-otp-session', (req, res) => {
  const { userId, type } = req.body;
  
  if (!userId || !type || !['code', 'password'].includes(type)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  const sessionId = `otp_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  otpSessions.set(sessionId, {
    userId,
    type,
    timestamp: Date.now(),
    confirmed: false
  });
  
  res.json({ sessionId, url: `/otp/${sessionId}` });
});

// Webhook endpoint for Telegram
app.use('/webhook', webhookCallback(bot, 'express'));

// Set webhook URL (you need to call this once to register your webhook with Telegram)
app.post('/set-webhook', async (req, res) => {
  try {
    const webhookUrl = req.body.url || `${req.protocol}://${req.get('host')}/webhook`;
    await bot.api.setWebhook(webhookUrl);
    res.json({ 
      success: true, 
      message: `Webhook set to: ${webhookUrl}` 
    });
  } catch (error) {
    console.error('Error setting webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to set webhook' 
    });
  }
});

// Remove webhook (useful for switching back to long polling)
app.post('/remove-webhook', async (req, res) => {
  try {
    await bot.api.deleteWebhook();
    res.json({ 
      success: true, 
      message: 'Webhook removed successfully' 
    });
  } catch (error) {
    console.error('Error removing webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to remove webhook' 
    });
  }
});

// Get webhook info
app.get('/webhook-info', async (req, res) => {
  try {
    const webhookInfo = await bot.api.getWebhookInfo();
    res.json(webhookInfo);
  } catch (error) {
    console.error('Error getting webhook info:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get webhook info' 
    });
  }
});

// Initialize bot before starting server
async function startServer() {
  try {
    await initializeBot();
    
    // Start the server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Express server running on port ${PORT}`);
      console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`⚙️  Set webhook: POST http://localhost:${PORT}/set-webhook`);
    });
  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export { app, bot }; 