import express from 'express';
import { webhookCallback } from 'grammy';
import { bot } from './index.js';

// Create Express app
const app = express();

// Middleware to parse JSON
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`⚙️  Set webhook: POST http://localhost:${PORT}/set-webhook`);
});

export { app, bot }; 