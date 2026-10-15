import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import productRoutes from './routes/productRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';

import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import mongoose from 'mongoose';
import { connectDB } from './config/database.js';

const app = express();

// Security HTTP headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS configuration supporting production Vercel frontend & local development
const frontendUrl = process.env.FRONTEND_URL || 'https://zorvi-fontend.vercel.app';
const allowedOrigins = [
  frontendUrl,
  'https://zorvi-fontend.vercel.app',
  'https://zorvi-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) return callback(null, true);
      // Allow any localhost / 127.0.0.1 port in development
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // Allow any vercel preview deployment for zorvi
      if (/^https:\/\/zorvi-.*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Razorpay-Signature'],
  })
);

// Instant Health Check & Root Ping (does not block on DB cold-start)
app.get(['/', '/api', '/api/health'], (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ZORVI Phase 3 API server operational',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Ensure MongoDB Atlas is connected during serverless (e.g. Vercel) invocations
let dbPromise = null;
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    if (!dbPromise) {
      dbPromise = connectDB().catch((err) => {
        dbPromise = null;
        console.error('[Serverless] MongoDB connection error:', err.message);
      });
    }
    await dbPromise;
  }
  next();
});

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Cookie parser
app.use(cookieParser());

// Body parsing with safe size limits and rawBody capture for webhook signature verification
app.use(
  express.json({
    limit: '5mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// General Rate Limiter on API endpoints
app.use('/api', apiLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/uploads', uploadRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ZORVI Phase 3 API server operational',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 404 Handler
app.use(notFound);

// Centralized Error Handler
app.use(errorHandler);

export default app;
