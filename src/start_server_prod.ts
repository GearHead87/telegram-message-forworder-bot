import cluster from 'cluster';
import os from 'os';
import express from 'express';
import { webhookCallback } from 'grammy';
import { bot, initializeBot } from './index.js';
import type { Request, Response, NextFunction } from 'express';
import { getOtpForm, postOtpSubmission, getOtpStatus, createOtpSession } from './controllers/AuthControllers.js';

// Production-ready server with clustering
const numCPUs = os.cpus().length;
const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Export variables for module usage
let app: express.Application;

if (cluster.isPrimary) {
  console.log(`🚀 Master process ${process.pid} is running`);
  console.log(`📊 Spawning ${numCPUs} worker processes...`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Handle worker exit
  cluster.on('exit', (worker, code, signal) => {
    console.error(`💀 Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });

  // Graceful shutdown for master
  const gracefulShutdown = () => {
    console.log('🛑 Master received shutdown signal. Shutting down workers...');

    for (const id in cluster.workers) {
      cluster.workers[id]?.kill();
    }

    setTimeout(() => {
      console.log('🔴 Force exit after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
} else {
  // Worker process
  console.log(`👷 Worker ${process.pid} started`);

  // Create Express app
  app = express();

  // Trust proxy (important for VPS behind reverse proxy)
  app.set('trust proxy', true);

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request timeout middleware
  app.use((req, res, next) => {
    req.setTimeout(30000); // 30 seconds timeout
    res.setTimeout(30000);
    next();
  });

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // OTP session endpoints
  app.get('/otp/:sessionId', getOtpForm as unknown as NextFunction);
  app.post('/otp/:sessionId', postOtpSubmission as unknown as NextFunction);
  app.get('/api/otp-status/:sessionId', getOtpStatus as unknown as NextFunction);
  app.post('/api/create-otp-session', createOtpSession as unknown as NextFunction);

  // Health check endpoint with detailed information
  app.get('/health', async (req: Request, res: Response): Promise<void> => {
    try {
      // Check database connection
      const mongoose = await import('mongoose');
      const dbStatus = mongoose.default.connection.readyState === 1 ? 'connected' : 'disconnected';

      // Check bot status
      let botStatus = 'unknown';
      try {
        await bot.api.getMe();
        botStatus = 'active';
      } catch (botError) {
        console.error('Bot status check error:', botError);
        botStatus = 'error';
      }

      const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
        database: dbStatus,
        bot: botStatus,
        environment: process.env.NODE_ENV || 'development',
      };

      res.json(healthData);
    } catch (error) {
      console.error('Health check error:', error);
      res.status(500).json({
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      });
    }
  });

  // Readiness probe (for Kubernetes/Docker health checks)
  app.get('/ready', async (req: Request, res: Response): Promise<void> => {
    try {
      const mongoose = await import('mongoose');
      if (mongoose.default.connection.readyState !== 1) {
        throw new Error('Database not connected');
      }

      await bot.api.getMe();
      res.json({ status: 'READY' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(503).json({ status: 'NOT_READY', error: errorMessage });
    }
  });

  // Liveness probe
  app.get('/live', (req: Request, res: Response) => {
    res.json({ status: 'ALIVE', pid: process.pid });
  });

  // Webhook endpoint for Telegram with error handling
  app.use('/webhook', webhookCallback(bot, 'express'));

  // Set webhook URL with production server URL
  app.post('/set-webhook', async (req: Request, res: Response): Promise<void> => {
    try {
      const webhookUrl = req.body.url || `${SERVER_URL}/webhook`;

      // Validate webhook URL
      if (!webhookUrl.startsWith('https://') && process.env.NODE_ENV === 'production') {
        res.status(400).json({
          success: false,
          error: 'Webhook URL must use HTTPS in production',
        });
      }

      const result = await bot.api.setWebhook(webhookUrl, {
        drop_pending_updates: true,
        max_connections: 100,
        allowed_updates: ['message', 'callback_query'],
      });

      console.log(`✅ Webhook set to: ${webhookUrl}`);

      res.json({
        success: true,
        message: `Webhook set to: ${webhookUrl}`,
        result,
      });
    } catch (error) {
      console.error('Error setting webhook:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        success: false,
        error: 'Failed to set webhook',
        details: errorMessage,
      });
    }
  });

  // Remove webhook
  app.post('/remove-webhook', async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await bot.api.deleteWebhook({ drop_pending_updates: true });
      console.log('✅ Webhook removed successfully');

      res.json({
        success: true,
        message: 'Webhook removed successfully',
        result,
      });
    } catch (error) {
      console.error('Error removing webhook:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        success: false,
        error: 'Failed to remove webhook',
        details: errorMessage,
      });
    }
  });

  // Get webhook info
  app.get('/webhook-info', async (req: Request, res: Response): Promise<void> => {
    try {
      const webhookInfo = await bot.api.getWebhookInfo();
      res.json({
        success: true,
        ...webhookInfo,
      });
    } catch (error) {
      console.error('Error getting webhook info:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        success: false,
        error: 'Failed to get webhook info',
        details: errorMessage,
      });
    }
  });

  // Bot info endpoint
  app.get('/bot-info', async (req: Request, res: Response): Promise<void> => {
    try {
      const botInfo = await bot.api.getMe();
      res.json({
        success: true,
        bot: botInfo,
      });
    } catch (error) {
      console.error('Error getting bot info:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        success: false,
        error: 'Failed to get bot info',
        details: errorMessage,
      });
    }
  });

  // Error handling middleware
  app.use((error: Error, req:Request, res:Response, next:NextFunction): void => {
    console.error('Express error:', error);

    if (res.headersSent) {
      next(error);
    }

    res.status(500).json({
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: req.path,
    });
  });

  // 404 handler
  app.use('*', (req: Request, res: Response): void => {
    res.status(404).json({
      error: 'Not found',
      path: req.path,
      timestamp: new Date().toISOString(),
    });
  });

  // Initialize bot and database connection
  const initializeApp = async () => {
    try {
      console.log(`🤖 Worker ${process.pid}: Initializing bot...`);
      await initializeBot();
      console.log(`✅ Worker ${process.pid}: Bot initialized successfully`);

      // Start the server
      const server = app.listen(PORT, () => {
        console.log(`🚀 Worker ${process.pid}: Express server running on port ${PORT}`);
        console.log(`📡 Webhook endpoint: ${SERVER_URL}/webhook`);
        console.log(`🏥 Health check: ${SERVER_URL}/health`);
        console.log(`⚙️  Set webhook: POST ${SERVER_URL}/set-webhook`);
        console.log(`🤖 Bot info: GET ${SERVER_URL}/bot-info`);
      });

      // Graceful shutdown for worker
      const gracefulShutdown = () => {
        console.log(`🛑 Worker ${process.pid}: Received shutdown signal`);

        server.close((err) => {
          if (err) {
            console.error(`❌ Worker ${process.pid}: Error during server shutdown:`, err);
            process.exit(1);
          }

          console.log(`✅ Worker ${process.pid}: Server closed`);

          // Close database connection
          import('mongoose')
            .then((mongoose) => {
              mongoose.default.connection
                .close()
                .then(() => {
                  console.log(`✅ Worker ${process.pid}: Database connection closed`);
                  process.exit(0);
                })
                .catch(() => {
                  process.exit(0);
                });
            })
            .catch(() => {
              process.exit(0);
            });
        });

        // Force close after timeout
        setTimeout(() => {
          console.log(`🔴 Worker ${process.pid}: Force exit after timeout`);
          process.exit(1);
        }, 5000);
      };

      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
    } catch (error) {
      console.error(`💥 Worker ${process.pid}: Failed to initialize:`, error);
      process.exit(1);
    }
  };

  // Initialize the worker
  initializeApp();
}

export { app, bot };
