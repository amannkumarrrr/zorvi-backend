import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import app from './src/app.js';
import { connectDB } from './src/config/database.js';

// Serverless database connection caching for Vercel
let dbPromise = null;

app.use(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    if (!dbPromise) {
      dbPromise = connectDB().catch((err) => {
        dbPromise = null;
        console.error('[Vercel Serverless] MongoDB connection error:', err.message);
      });
    }
    await dbPromise;
  }
  next();
});

export default app;
