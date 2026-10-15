import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import PasswordReset from '../models/PasswordReset.js';
import SignupVerification from '../models/SignupVerification.js';
import emailService from '../services/emailService.js';


/**
 * Cookie options helper
 */
const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction, // HTTPS only in production
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/',
  };
};

/**
 * Generates signed JWT token
 */
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

/**
 * Internal HMAC-SHA256 hasher for OTPs and single-use authorization tokens
 */
const hashSecret = (secret) => {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'aura_reset_secret_key')
    .update(String(secret))
    .digest('hex');
};

/**
 * POST /api/auth/signup-otp
 * Step 1: Validates email, checks non-existence, enforces 60s cooldown,
 * generates a 6-digit OTP, stores its HMAC hash with 5-min expiry,
 * and sends via Resend.
 */
export const sendSignupOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.',
        errors: [{ field: 'email', message: 'Email address is required.' }],
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Reject early if user is already registered
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists. Please log in instead.',
        errors: [{ field: 'email', message: 'Email address is already registered.' }],
      });
    }

    // Check cooldown (60 seconds)
    const existingVerification = await SignupVerification.findOne({
      email: normalizedEmail,
      resendAvailableAt: { $gt: new Date() },
    });

    if (existingVerification) {
      const remainingSeconds = Math.max(
        1,
        Math.ceil((existingVerification.resendAvailableAt.getTime() - Date.now()) / 1000)
      );
      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} before requesting another verification code.`,
        remainingSeconds,
      });
    }

    // Generate cryptographically secure random 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashSecret(otp);

    // Send email via Brevo SMTP
    const emailResult = await emailService.sendSignupOtp({
      email: normalizedEmail,
      otp,
      expiresInMinutes: 5,
    });

    if (!emailResult.success) {
      const isAuthOrConfigIssue =
        emailResult.code === 535 ||
        emailResult.error?.toLowerCase().includes('auth') ||
        emailResult.error?.toLowerCase().includes('credential');

      return res.status(502).json({
        success: false,
        message: 'Unable to deliver verification email at this time. Please try again later.',
        code: 'EMAIL_DELIVERY_FAILED',
        hint: isAuthOrConfigIssue
          ? 'Brevo SMTP authentication failed. Please verify that BREVO_SMTP_USER and BREVO_SMTP_KEY are set correctly.'
          : undefined,
        error: process.env.NODE_ENV !== 'production' ? emailResult.error : undefined,
      });
    }

    const now = Date.now();
    const expiresAt = new Date(now + 5 * 60 * 1000); // 5 minutes validity
    const resendAvailableAt = new Date(now + 60 * 1000); // 60 seconds cooldown

    // Save/update verification record ONLY AFTER email was accepted by provider
    await SignupVerification.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otpHash,
        expiresAt,
        resendAvailableAt,
        attempts: 0,
        verified: false,
        signupTokenHash: null,
        signupTokenExpiresAt: null,
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'A 6-digit verification code has been sent to your email address.',
      cooldownSeconds: 60,
      expiresSeconds: 300,
      messageId: emailResult.id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/verify-signup-otp
 * Step 2: Verifies 6-digit OTP using timing-safe HMAC comparison,
 * invalidates OTP immediately, and issues a short-lived single-use signupToken.
 */
export const verifySignupOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email address and 6-digit verification code are required.',
        errors: [],
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const record = await SignupVerification.findOne({
      email: normalizedEmail,
      expiresAt: { $gt: new Date() },
    }).select('+otpHash');

    if (!record || !record.otpHash) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired or is invalid. Please request a new code.',
        errors: [],
      });
    }

    if (record.attempts >= 5) {
      record.otpHash = null;
      await record.save();
      return res.status(429).json({
        success: false,
        message: 'Maximum verification attempts exceeded (5/5). Please request a new code.',
        errors: [],
      });
    }

    const candidateHash = hashSecret(cleanOtp);
    const isMatch = Boolean(
      record.otpHash &&
      candidateHash.length === record.otpHash.length &&
      crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(record.otpHash))
    );

    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      const attemptsRemaining = Math.max(0, 5 - record.attempts);
      return res.status(400).json({
        success: false,
        message:
          attemptsRemaining > 0
            ? `Invalid verification code. (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining)`
            : 'Maximum verification attempts exceeded. Please request a new code.',
        attemptsRemaining,
      });
    }

    // Invalidate OTP immediately to prevent reuse
    record.otpHash = null;
    record.verified = true;

    // Issue single-use signupToken
    const signupToken = crypto.randomBytes(32).toString('hex');
    record.signupTokenHash = hashSecret(signupToken);
    record.signupTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    await record.save();

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully. Please complete your registration details.',
      data: {
        signupToken,
        email: normalizedEmail,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/register
 * Step 3: Completes customer registration using verified signupToken
 */
export const register = async (req, res, next) => {
  try {
    const { name, email, password, signupToken } = req.body;

    if (!signupToken) {
      return res.status(400).json({
        success: false,
        message: 'Email verification token is required to complete registration.',
        errors: [{ field: 'signupToken', message: 'Verification token missing.' }],
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify single-use signupToken
    const candidateTokenHash = hashSecret(signupToken.trim());
    const verificationRecord = await SignupVerification.findOne({
      email: normalizedEmail,
      verified: true,
      signupTokenExpiresAt: { $gt: new Date() },
    }).select('+signupTokenHash');

    const isTokenValid = Boolean(
      verificationRecord &&
      verificationRecord.signupTokenHash &&
      candidateTokenHash.length === verificationRecord.signupTokenHash.length &&
      crypto.timingSafeEqual(Buffer.from(candidateTokenHash), Buffer.from(verificationRecord.signupTokenHash))
    );

    if (!isTokenValid) {
      return res.status(400).json({
        success: false,
        message: 'Email verification session has expired or is invalid. Please verify your email again.',
        errors: [{ field: 'signupToken', message: 'Invalid or expired signup token.' }],
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
        errors: [{ field: 'email', message: 'Email address is already registered.' }],
      });
    }

    // Hash password & create customer
    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'customer', // Always customer for public registration
      isEmailVerified: true,
    });

    // Invalidate / consume the verification record immediately
    await SignupVerification.deleteOne({ _id: verificationRecord._id });

    // Generate token & set cookie
    const token = generateToken(user);
    res.cookie('aura_token', token, getCookieOptions());

    res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      data: {
        user: user.toSafeObject(),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/login
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
        errors: [],
      });
    }

    let normalizedEmail = email.trim().toLowerCase();
    // Allow logging in with username "admin" or "administrator" as alias for admin email
    if (
      normalizedEmail === 'admin' ||
      normalizedEmail === 'administrator' ||
      normalizedEmail === 'auraadmin'
    ) {
      normalizedEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    }

    // Find user with passwordHash
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        errors: [],
      });
    }

    // Verify password with bcrypt
    const rawPass = String(password);
    const trimmedPass = rawPass.trim();

    const isMatch = (await user.comparePassword(rawPass)) || (await user.comparePassword(trimmedPass));

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        errors: [],
      });
    }

    // Generate token & set cookie
    const token = generateToken(user);
    res.cookie('aura_token', token, getCookieOptions());

    res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      data: {
        user: user.toSafeObject(),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/logout
 */
export const logout = async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('aura_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully.',
  });
};

/**
 * GET /api/auth/me
 */
export const getMe = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated.',
      errors: [],
    });
  }

  res.status(200).json({
    success: true,
    message: 'Profile retrieved successfully.',
    data: {
      user: req.user.toSafeObject(),
    },
  });
};

/**
 * POST /api/auth/forgot-password
 * Initiates password reset by sending a 6-digit OTP via Resend.
 * Returns a generic success response to prevent email enumeration.
 */
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.',
        errors: [{ field: 'email', message: 'Email address is required.' }],
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if an account exists for this email
    const user = await User.findOne({ email: normalizedEmail });

    // Generic response returned regardless of account existence to prevent enumeration
    const genericResponse = {
      success: true,
      message: 'If an account exists with this email address, a 6-digit verification code has been sent.',
      cooldownSeconds: 60,
      expiresSeconds: 300,
    };

    if (!user || !user.isActive) {
      // Do not reveal that email doesn't exist; return generic success
      return res.status(200).json(genericResponse);
    }

    // Check active cooldown for this user/email
    const existingReset = await PasswordReset.findOne({
      userId: user._id,
      resendAvailableAt: { $gt: new Date() },
    });

    if (existingReset) {
      const remainingSeconds = Math.max(1, Math.ceil((existingReset.resendAvailableAt.getTime() - Date.now()) / 1000));
      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} before requesting another code.`,
        remainingSeconds,
      });
    }

    // Generate cryptographically secure random 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashSecret(otp);

    // Send email via Brevo SMTP FIRST
    const emailResult = await emailService.sendPasswordResetOtp({
      email: user.email,
      name: user.name,
      otp,
      expiresInMinutes: 5,
    });

    if (!emailResult.success) {
      const isAuthOrConfigIssue =
        emailResult.code === 535 ||
        emailResult.error?.toLowerCase().includes('auth') ||
        emailResult.error?.toLowerCase().includes('credential');

      return res.status(502).json({
        success: false,
        message: 'Unable to deliver verification email at this time. Please try again later.',
        code: 'EMAIL_DELIVERY_FAILED',
        hint: isAuthOrConfigIssue
          ? 'Brevo SMTP authentication failed. Please verify that BREVO_SMTP_USER and BREVO_SMTP_KEY are set correctly.'
          : undefined,
        error: process.env.NODE_ENV !== 'production' ? emailResult.error : undefined,
      });
    }

    const now = Date.now();
    const expiresAt = new Date(now + 5 * 60 * 1000); // 5 minutes validity
    const resendAvailableAt = new Date(now + 60 * 1000); // 60 seconds cooldown

    // Upsert PasswordReset record ONLY AFTER email was accepted by provider
    await PasswordReset.findOneAndUpdate(
      { userId: user._id },
      {
        userId: user._id,
        email: user.email,
        otpHash,
        expiresAt,
        resendAvailableAt,
        attempts: 0,
        used: false,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      ...genericResponse,
      messageId: emailResult.id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/verify-reset-otp
 * Verifies the 6-digit OTP and returns a short-lived single-use reset authorization token
 */
export const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email address and 6-digit verification code are required.',
        errors: [],
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    // Find active, unexpired, unused reset record for this email
    const record = await PasswordReset.findOne({
      email: normalizedEmail,
      used: false,
      expiresAt: { $gt: new Date() },
    }).select('+otpHash');

    if (!record || !record.otpHash) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired or is invalid. Please request a new code.',
        errors: [],
      });
    }

    // Check if maximum verification attempts exceeded
    if (record.attempts >= 5) {
      record.used = true;
      await record.save();
      return res.status(429).json({
        success: false,
        message: 'Maximum verification attempts exceeded (5/5). Please request a new code.',
        errors: [],
      });
    }

    // Verify OTP hash using timing-safe comparison
    const candidateHash = hashSecret(cleanOtp);
    const isMatch = Boolean(
      record.otpHash &&
      candidateHash.length === record.otpHash.length &&
      crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(record.otpHash))
    );

    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      const attemptsRemaining = Math.max(0, 5 - record.attempts);
      return res.status(400).json({
        success: false,
        message:
          attemptsRemaining > 0
            ? `Invalid verification code. (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining)`
            : 'Maximum verification attempts exceeded. Please request a new code.',
        attemptsRemaining,
      });
    }

    // OTP verified successfully: Invalidate OTP immediately to prevent replay
    record.otpHash = null;

    // Generate single-use, cryptographically secure reset authorization token
    const resetToken = crypto.randomBytes(32).toString('hex');
    record.resetTokenHash = hashSecret(resetToken);
    record.resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes window to complete reset
    await record.save();

    return res.status(200).json({
      success: true,
      message: 'Verification code verified successfully. Please choose your new password.',
      data: {
        resetToken,
        email: normalizedEmail,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/reset-password
 * Authoritatively updates user password using the single-use reset authorization token
 */
export const resetPassword = async (req, res, next) => {
  try {
    const { email, resetToken, newPassword } = req.body;

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, reset authorization token, and new password are required.',
        errors: [],
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters in length.',
        errors: [{ field: 'newPassword', message: 'Password must be at least 6 characters.' }],
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const candidateTokenHash = hashSecret(resetToken.trim());

    // Find active reset record with matching resetTokenHash
    const record = await PasswordReset.findOne({
      email: normalizedEmail,
      used: false,
      resetTokenExpiresAt: { $gt: new Date() },
    }).select('+resetTokenHash');

    const isTokenValid = Boolean(
      record &&
      record.resetTokenHash &&
      candidateTokenHash.length === record.resetTokenHash.length &&
      crypto.timingSafeEqual(Buffer.from(candidateTokenHash), Buffer.from(record.resetTokenHash))
    );

    if (!isTokenValid) {
      return res.status(400).json({
        success: false,
        message: 'Password reset authorization has expired or is invalid. Please restart the process.',
        errors: [],
      });
    }

    // Find user and update password
    const user = await User.findById(record.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Account not found.',
        errors: [],
      });
    }

    // Hash new password using bcrypt
    const newPasswordHash = await User.hashPassword(newPassword.trim());
    user.passwordHash = newPasswordHash;
    await user.save();

    // Invalidate reset session completely
    record.used = true;
    record.resetTokenHash = null;
    await record.save();

    // Invalidate auth cookie to force re-login
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('aura_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
    });

    return res.status(200).json({
      success: true,
      message: 'Your password has been reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

