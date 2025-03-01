import { webhookCallback } from "grammy";
import { bot } from "../src/index";

// Export the webhook callback for Vercel
export default webhookCallback(bot, "https");
