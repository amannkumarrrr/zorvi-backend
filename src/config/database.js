import mongoose from 'mongoose';
import Coupon from '../models/Coupon.js';
import User from '../models/User.js';

export const initAdminUser = async () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME || 'Aura Administrator';

  if (!adminEmail || !adminPassword) {
    return;
  }

  try {
    const normalizedEmail = adminEmail.trim().toLowerCase();
    const existingAdmin = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

    if (!existingAdmin) {
      const passwordHash = await User.hashPassword(adminPassword);
      await User.create({
        name: adminName,
        email: normalizedEmail,
        passwordHash,
        role: 'admin',
        isActive: true,
        isEmailVerified: true,
      });
      console.log(`[Admin] Initialized administrator account for ${normalizedEmail}`);
    } else {
      let modified = false;
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        modified = true;
      }
      if (!existingAdmin.isEmailVerified) {
        existingAdmin.isEmailVerified = true;
        modified = true;
      }
      // Ensure passwordHash is synchronized with ADMIN_PASSWORD environment variable
      const passwordMatches = await existingAdmin.comparePassword(adminPassword);
      if (!passwordMatches) {
        existingAdmin.passwordHash = await User.hashPassword(adminPassword);
        modified = true;
      }
      if (modified) {
        await existingAdmin.save();
        console.log(`[Admin] Synchronized administrator credentials for ${normalizedEmail}`);
      }
    }
  } catch (err) {
    console.warn('[Admin] Admin initialization notice:', err.message);
  }
};

export const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('FATAL: MONGODB_URI environment variable is missing.');
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI environment variable is missing.');
    }
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log(`[Database] MongoDB Atlas connected successfully: ${conn.connection.host}`);

    // Seed default coupons idempotently
    try {
      await Coupon.seedDefaultCoupons();
    } catch (err) {
      console.warn('[Database] Coupon seed warning:', err.message);
    }

    // Initialize or synchronize administrator account
    try {
      await initAdminUser();
    } catch (err) {
      console.warn('[Database] Admin initialization warning:', err.message);
    }

    mongoose.connection.on('error', (err) => {
      console.error('[Database] MongoDB runtime error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[Database] MongoDB disconnected. Attempting reconnect...');
    });

    return conn;
  } catch (error) {
    console.error('[Database] MongoDB connection failed:', error.message);
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      throw error;
    }
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    console.log('[Database] MongoDB connection closed gracefully.');
  } catch (error) {
    console.error('[Database] Error closing MongoDB connection:', error.message);
  }
};

export default connectDB;
