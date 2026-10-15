import express from 'express';
import {
  sendSignupOtp,
  verifySignupOtp,
  register,
  login,
  logout,
  getMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  signupOtpSchema,
  verifySignupOtpSchema,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
} from '../utils/validators.js';
import { authLimiter, passwordResetLimiter, signupLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Signup Email OTP Routes (Step 1 & Step 2)
router.post('/signup-otp', signupLimiter, validate(signupOtpSchema), sendSignupOtp);
router.post('/verify-signup-otp', signupLimiter, validate(verifySignupOtpSchema), verifySignupOtp);

// Registration & Auth
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/login', authLimiter, validate(loginSchema), login);
router.post('/logout', logout);
router.get('/me', authenticate, getMe);

// Password Reset Routes
router.post('/forgot-password', passwordResetLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/verify-reset-otp', passwordResetLimiter, validate(verifyResetOtpSchema), verifyResetOtp);
router.post('/reset-password', passwordResetLimiter, validate(resetPasswordSchema), resetPassword);

export default router;

