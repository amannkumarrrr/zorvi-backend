import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { connectDB, disconnectDB } from './config/database.js';

const PORT = process.env.PORT || 5001;
let server = null;

const startServer = async () => {
  // Prevent duplicate initialization
  if (server) {
    console.warn('[Server] Server is already running. Ignoring duplicate start call.');
    return;
  }

  try {
    // Connect to MongoDB Atlas and initialize defaults before starting HTTP listener
    await connectDB();

    server = app.listen(PORT, () => {
      console.log(`[Server] ZORVI API server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port conflict detected: Port ${PORT} is already in use.`);
      } else {
        console.error('[Server] Server listen error:', err.message);
      }
      process.exit(1);
    });

    // Graceful shutdown handling
    const shutdown = async (signal) => {
      console.log(`\n[Process] Received ${signal}. Shutting down gracefully...`);
      if (server) {
        server.close(() => {
          console.log('[Server] HTTP server closed.');
        });
      }
      await disconnectDB();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('unhandledRejection', (err) => {
      console.error('[Process] Unhandled Rejection:', err.message);
    });

    process.on('uncaughtException', (err) => {
      console.error('[Process] Uncaught Exception:', err.message);
      process.exit(1);
    });
  } catch (error) {
    const safeErrorMsg = (error.message || '').replace(
      /mongodb(\+srv)?:\/\/[^@]+@/gi,
      'mongodb$1://<credentials-hidden>@'
    );
    console.error('[Server] Fatal server startup error:', safeErrorMsg);
    process.exit(1);
  }
};

startServer();

export default app;
