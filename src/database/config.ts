import mongoose from 'mongoose';
import { env } from '../env.js';

// Production-ready MongoDB connection configuration
const connectionOptions: mongoose.ConnectOptions = {
  // Connection pool settings
  maxPoolSize: 5, // Maximum number of connections in the pool
  minPoolSize: 0,  // Minimum number of connections in the pool
  
  // Connection timeout settings
  serverSelectionTimeoutMS: 10000, // How long to try selecting a server
  socketTimeoutMS: 45000, // How long a send or receive on a socket can take before timing out
  connectTimeoutMS: 10000, // How long to wait for a connection to be established
  
  // Heartbeat settings
  heartbeatFrequencyMS: 10000, // How often to check the connection
  
  // Buffer settings
  bufferCommands: false, // Disable mongoose buffering for commands
  
  // Retry settings
  retryWrites: true,
  retryReads: true,
  
  // Other production settings
  maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
  compressors: ['zlib'], // Enable compression
};

// Connection retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Connection state tracking
let isConnecting = false;
let connectionAttempts = 0;

export async function connectDB(): Promise<void> {
  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    console.log('⏳ Database connection already in progress...');
    return;
  }

  // Check if already connected
  if (mongoose.connection.readyState === 1) {
    console.log('✅ Database already connected');
    return;
  }

  isConnecting = true;

  try {
    await connectWithRetry();
  } catch (error) {
    console.error('💥 Failed to connect to database after all retries:', error);
    process.exit(1);
  } finally {
    isConnecting = false;
  }
}

async function connectWithRetry(): Promise<void> {
  while (connectionAttempts < MAX_RETRIES) {
    try {
      connectionAttempts++;
      console.log(`🔌 Attempting to connect to MongoDB (attempt ${connectionAttempts}/${MAX_RETRIES})...`);

      await mongoose.connect(env.MONGODB_URI, {
        ...connectionOptions,
        dbName: env.DATABASE_NAME,
      });

      console.log('✅ Connected to MongoDB - TelegramBot Database');
      console.log(`📊 Database: ${env.DATABASE_NAME}`);
      console.log(`🔗 Connection state: ${getConnectionState()}`);
      
      // Reset connection attempts on successful connection
      connectionAttempts = 0;
      return;

    } catch (error) {
      console.error(`❌ MongoDB connection attempt ${connectionAttempts} failed:`, error);
      
      if (connectionAttempts >= MAX_RETRIES) {
        throw new Error(`Failed to connect to MongoDB after ${MAX_RETRIES} attempts`);
      }

      console.log(`⏳ Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

// Helper function to get human-readable connection state
function getConnectionState(): string {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized'
  };
  return states[mongoose.connection.readyState as keyof typeof states] || 'unknown';
}

// Production-ready event handlers
function setupConnectionEventHandlers(): void {
  // Connection successful
  mongoose.connection.on('connected', () => {
    console.log('✅ Mongoose connected to MongoDB');
  });

  // Connection error
  mongoose.connection.on('error', (error) => {
    console.error('❌ Mongoose connection error:', error);
    
    // Don't exit process on connection errors - let retry logic handle it
    if (mongoose.connection.readyState === 0) {
      console.log('🔄 Attempting to reconnect...');
      setTimeout(() => {
        if (mongoose.connection.readyState === 0) {
          connectDB().catch(console.error);
        }
      }, RETRY_DELAY);
    }
  });

  // Connection disconnected
  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  Mongoose disconnected from MongoDB');
    
    // Attempt to reconnect if not in the process of disconnecting
    if (mongoose.connection.readyState === 0 && !isConnecting) {
      console.log('🔄 Attempting to reconnect...');
      setTimeout(() => {
        if (mongoose.connection.readyState === 0) {
          connectDB().catch(console.error);
        }
      }, RETRY_DELAY);
    }
  });

  // Connection reconnected
  mongoose.connection.on('reconnected', () => {
    console.log('🔄 Mongoose reconnected to MongoDB');
  });

  // Application termination handlers
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

// Graceful shutdown function
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n🛑 Received ${signal}. Starting graceful database shutdown...`);
  
  try {
    await mongoose.connection.close();
    console.log('✅ Database connection closed gracefully');
  } catch (error) {
    console.error('❌ Error during database shutdown:', error);
  }
}

// Health check function for the database
export function getDatabaseHealth(): {
  status: string;
  readyState: number;
  host?: string;
  name?: string;
  collections?: number;
} {
  const connection = mongoose.connection;
  
  return {
    status: getConnectionState(),
    readyState: connection.readyState,
    host: connection.host,
    name: connection.name,
    collections: connection.db ? Object.keys(connection.db.collections || {}).length : 0
  };
}

// Initialize event handlers
setupConnectionEventHandlers();

// Export connection instance for advanced usage
export { mongoose };
