import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import 'dotenv/config';
 
export const env = createEnv({
  server: {
    // Telegram Bot Configuration
    TELEGRAM_BOT_TOKEN: z.string().min(1, "Telegram bot token is required"),
    API_ID: z.string().min(1, "API ID is required"),
    API_HASH: z.string().min(1, "API HASH is required"),
    
    // Database Configuration
    MONGODB_URI: z.string().min(1, "MongoDB URI is required"),
    DATABASE_NAME: z.string().min(1, "Database name is required"),
    USER_COLLECTION_NAME: z.string().min(1, "User collection name is required"),
    
    // Server Configuration
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().regex(/^\d+$/).transform(Number).default(() => 3000),
    SERVER_URL: z.string().url(),

    // Logging Configuration
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  },

  runtimeEnv: process.env,

  emptyStringAsUndefined: true,

  // Skip validation during build if needed
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
});