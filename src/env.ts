import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import 'dotenv/config';
 
export const env = createEnv({
  server: {
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    MONGODB_URI: z.string().min(1),
    DATABASE_NAME: z.string().min(1),
    USER_COLLECTION_NAME: z.string().min(1),
  },

  runtimeEnv: process.env,

  emptyStringAsUndefined: true,
});