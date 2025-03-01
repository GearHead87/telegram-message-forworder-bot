import { webhookCallback } from "grammy";
import { bot } from "../src/index.js";

// Export the webhook callback for Vercel
export default webhookCallback(bot, "https");
