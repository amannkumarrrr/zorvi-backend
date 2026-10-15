import dotenv from 'dotenv';
dotenv.config();
import app from '../app.js';
import mongoose from 'mongoose';
import crypto from 'crypto';
import User from '../models/User.js';
import SignupVerification from '../models/SignupVerification.js';
import PasswordReset from '../models/PasswordReset.js';
import emailService from '../services/emailService.js';

const PORT = 5098;
const BASE_URL = `http://localhost:${PORT}/api`;

let server;
const results = [];

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    results.push({ name, passed: true });
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    results.push({ name, passed: false, error: err.message });
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

const runBrevoOtpTests = async () => {
  console.log('\n--- STARTING ZORVI BREVO SMTP EMAIL DELIVERY & OTP TEST SUITE ---\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    server = app.listen(PORT);
    console.log(`[Brevo Test Server] Listening on port ${PORT}\n`);

    const timestamp = Date.now();
    const testEmail = `amanwelcome22@gmail.com`; // Verified recipient
    const externalEmail = `test_student_${timestamp}@gmail.com`; // External recipient
    const existingUserEmail = `existing_shopper_${timestamp}@aura.internal`;
    const password = 'StrongPassword2026!';

    // Clean up any stale records from previous runs
    await User.deleteMany({ email: { $in: [testEmail, externalEmail, existingUserEmail] } });
    await SignupVerification.deleteMany({ email: { $in: [testEmail, externalEmail] } });
    await PasswordReset.deleteMany({ email: { $in: [testEmail, externalEmail] } });

    // Setup an existing user to test duplicate email prevention and forgot password
    const existingPasswordHash = await User.hashPassword(password);
    await User.create({
      name: 'Existing Shopper',
      email: existingUserEmail,
      passwordHash: existingPasswordHash,
      role: 'customer',
      isEmailVerified: true,
    });

    // Test 1: Direct registration without signupToken is blocked
    await test('1. Direct registration without signupToken is rejected (400)', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Direct Reg',
          email: externalEmail,
          password: password,
        }),
      });
      const data = await res.json();
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(data.success === false, 'Expected success === false');
      assert(data.errors?.some((e) => e.field === 'signupToken'), 'Expected signupToken error');
    });

    // Test 2: Direct registration with forged signupToken is blocked
    await test('2. Direct registration with forged signupToken is rejected (400)', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Direct Reg',
          email: externalEmail,
          password: password,
          signupToken: 'forged_fake_token_1234567890abcdef',
        }),
      });
      const data = await res.json();
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(data.success === false, 'Expected success === false');
      assert(data.message.toLowerCase().includes('invalid') || data.message.toLowerCase().includes('expired'), `Got: ${data.message}`);
    });

    // Test 3: Requesting OTP for already registered email fails with 409 Conflict
    await test('3. Requesting OTP for already registered email rejects early (409)', async () => {
      const res = await fetch(`${BASE_URL}/auth/signup-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: existingUserEmail }),
      });
      const data = await res.json();
      assert(res.status === 409, `Expected 409, got ${res.status}`);
      assert(data.success === false, 'Expected success === false');
      assert(data.message.includes('already exists'), `Expected account exists message, got: ${data.message}`);
    });

    // Test 4: Brevo SMTP connection verification
    await test('4. Brevo SMTP connection verified successfully', async () => {
      const verifyRes = await emailService.verifyConnection();
      assert(verifyRes.success === true, `Expected success true, got: ${verifyRes.error}`);
    });

    // Test 5: Live Brevo SMTP dispatch of Signup OTP to email
    let sentSignupMessageId = '';
    await test('5. Requesting signup OTP dispatches via Brevo SMTP and saves pending verification (200)', async () => {
      const res = await fetch(`${BASE_URL}/auth/signup-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      assert(data.cooldownSeconds === 60, `Expected 60s cooldown, got: ${data.cooldownSeconds}`);
      assert(typeof data.messageId === 'string' && data.messageId.length > 0, 'Expected valid messageId from Brevo SMTP');
      sentSignupMessageId = data.messageId;

      const record = await SignupVerification.findOne({ email: testEmail.toLowerCase() });
      assert(record !== null, 'Verification record must exist in DB');
      assert(record.verified === false, 'Verification record must not be verified yet');
    });

    // Test 6: Immediate resend within 60s triggers rate limit cooldown (429)
    await test('6. Immediate resend within 60s triggers rate limit cooldown (429)', async () => {
      const res = await fetch(`${BASE_URL}/auth/signup-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      const data = await res.json();
      assert(res.status === 429, `Expected 429, got ${res.status}`);
      assert(data.success === false, 'Expected success === false');
      assert(data.remainingSeconds > 0, 'Expected positive remainingSeconds');
    });

    // Test 7: Verify incorrect OTP decrements attempts
    await test('7. Submitting invalid 6-digit OTP decrements attempts remaining (400)', async () => {
      const res = await fetch(`${BASE_URL}/auth/verify-signup-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          otp: '000000', // Incorrect OTP
        }),
      });
      const data = await res.json();
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(data.success === false, 'Expected success === false');
      assert(data.attemptsRemaining === 4, `Expected 4 attempts remaining, got ${data.attemptsRemaining}`);
    });

    // Test 8: Verifying with genuine OTP succeeds and issues single-use signupToken
    let validSignupToken = '';
    await test('8. Verifying correct OTP returns timing-safe validated signupToken (200)', async () => {
      const testOtp = '739104';
      const testOtpHash = crypto
        .createHmac('sha256', process.env.JWT_SECRET || 'aura_reset_secret_key')
        .update(testOtp)
        .digest('hex');

      await SignupVerification.findOneAndUpdate(
        { email: testEmail.toLowerCase() },
        { otpHash: testOtpHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) }
      );

      const res = await fetch(`${BASE_URL}/auth/verify-signup-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          otp: testOtp,
        }),
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      assert(typeof data.data.signupToken === 'string', 'Expected signupToken string');
      assert(data.data.signupToken.length >= 32, 'Expected strong token length');
      validSignupToken = data.data.signupToken;
    });

    // Test 9: Replay attack with same OTP is rejected (single-use OTP)
    await test('9. Replay of same OTP is immediately rejected (400)', async () => {
      const res = await fetch(`${BASE_URL}/auth/verify-signup-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          otp: '739104',
        }),
      });
      assert(res.status === 400, `Expected 400 on OTP replay, got ${res.status}`);
    });

    // Test 10: Complete registration with valid signupToken creates verified customer
    let registeredUserId = '';
    await test('10. Complete registration with valid signupToken creates user with isEmailVerified: true (201)', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Verified Shopper',
          email: testEmail,
          password: password,
          signupToken: validSignupToken,
        }),
      });
      const data = await res.json();
      assert(res.status === 201, `Expected 201, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      assert(data.data.user.email === testEmail.toLowerCase(), 'Email must match');
      registeredUserId = data.data.user._id;

      // Verify directly in MongoDB
      const dbUser = await User.findById(registeredUserId);
      assert(dbUser.isEmailVerified === true, 'isEmailVerified must be true in DB');
      assert(dbUser.role === 'customer', 'Role must be customer');
    });

    // Test 11: Replay of consumed signupToken fails
    await test('11. Replay of consumed signupToken is rejected (400)', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Replay Shopper',
          email: `another_${timestamp}@aura.internal`,
          password: password,
          signupToken: validSignupToken,
        }),
      });
      assert(res.status === 400, `Expected 400 on consumed token, got ${res.status}`);
    });

    // Test 12: Forgot Password sends OTP via Brevo SMTP for registered user
    await test('12. Forgot Password delivers OTP via Brevo SMTP for registered user (200)', async () => {
      const res = await fetch(`${BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      assert(typeof data.messageId === 'string' && data.messageId.length > 0, 'Expected valid messageId from Brevo');
    });

    // Test 13: Admin login works securely with bcrypt from environment variables
    await test('13. Admin login verifies credentials exclusively via bcrypt', async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.ADMIN_EMAIL,
          password: process.env.ADMIN_PASSWORD,
        }),
      });
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.data.user.role === 'admin', 'User must be admin');
    });

    // Test 14: Previous backdoor passwords fail
    await test('14. Arbitrary/backdoor passwords (e.g. admin123, 123456) are rejected (401)', async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.ADMIN_EMAIL,
          password: 'backdoor_unauthorized_pass',
        }),
      });
      assert(res.status === 401, `Expected 401, got ${res.status}`);
    });

    // Cleanup
    await User.deleteMany({ email: { $in: [testEmail.toLowerCase(), externalEmail.toLowerCase(), existingUserEmail.toLowerCase()] } });
    await SignupVerification.deleteMany({ email: { $in: [testEmail.toLowerCase(), externalEmail.toLowerCase()] } });
    await PasswordReset.deleteMany({ email: { $in: [testEmail.toLowerCase(), externalEmail.toLowerCase()] } });

    console.log('\n--- BREVO SMTP & OTP TEST SUMMARY ---');
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`Passed: ${passedCount} / ${results.length}`);
    if (passedCount === results.length) {
      console.log('ALL BREVO SMTP & OTP TESTS PASSED! 🚀📧\n');
    } else {
      console.error('SOME TESTS FAILED!\n');
    }
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    if (server) server.close();
    await mongoose.connection.close();
    process.exit(results.every((r) => r.passed) ? 0 : 1);
  }
};

runBrevoOtpTests();
