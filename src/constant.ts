import 'dotenv/config'

const botToken = process.env.TELEGRAM_BOT_TOKEN as string;

if (!botToken) {
	throw new Error("TELEGRAM_BOT_TOKEN is not set");
}

export { botToken };