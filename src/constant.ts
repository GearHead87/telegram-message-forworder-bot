import 'dotenv/config';

const botToken = process.env.TELEGRAM_BOT_TOKEN as string;
const mongoURI = process.env.MONGODB_URI as string;
const databaseName = process.env.DATABASE_NAME as string;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}

if (!mongoURI) {
  throw new Error('MONGODB_URI is not set');
}

if (!databaseName) {  
  throw new Error('DATABASE_NAME is not set');
}

export { botToken, mongoURI, databaseName };
