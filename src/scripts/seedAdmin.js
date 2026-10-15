import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from '../models/User.js';

const seedAdmin = async () => {
  // Safety check: Prevent running in unintended production without confirmation
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_ADMIN_SEED) {
    console.error('ERROR: Admin seeding is disabled in production unless ALLOW_ADMIN_SEED=true.');
    process.exit(1);
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME || 'System Administrator';

  if (!adminEmail || !adminPassword) {
    console.error('ERROR: ADMIN_EMAIL and ADMIN_PASSWORD environment variables must be defined in .env.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[Seed] Connected to MongoDB Atlas.');

    const normalizedEmail = adminEmail.trim().toLowerCase();

    // Check if an admin with this email already exists
    const existingAdmin = await User.findOne({ email: normalizedEmail });

    if (existingAdmin) {
      console.log(`[Seed] An account with email "${normalizedEmail}" already exists.`);
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        await existingAdmin.save();
        console.log(`[Seed] Upgraded existing user "${normalizedEmail}" to admin role.`);
      } else {
        console.log(`[Seed] User "${normalizedEmail}" is already an administrator.`);
      }
    } else {
      const passwordHash = await User.hashPassword(adminPassword);
      await User.create({
        name: adminName,
        email: normalizedEmail,
        passwordHash,
        role: 'admin',
        isActive: true,
      });
      console.log(`[Seed] Successfully created administrator account: ${normalizedEmail}`);
    }

    await mongoose.connection.close();
    console.log('[Seed] Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('[Seed] Admin seeding error:', error.message);
    process.exit(1);
  }
};

seedAdmin();
