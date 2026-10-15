import express from 'express';
import {
  createOrder,
  verifyPayment,
  getQrPaymentStatus,
  cancelQrPayment,
  handleWebhook,
  simulateDemoSuccess,
  simulateDemoFailure,
  validateCoupon,
} from '../controllers/paymentController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// Webhook endpoint (must NOT be protected by customer auth, verified via Razorpay HMAC)
router.post('/webhook', handleWebhook);

// Protected payment endpoints
router.post('/create-order', authenticate, createOrder);
router.post('/verify', authenticate, verifyPayment);
router.get('/qr-status/:orderId', authenticate, getQrPaymentStatus);
router.post('/cancel-payment/:orderId', authenticate, cancelQrPayment);
router.post('/validate-coupon', authenticate, validateCoupon);

// College Project Demonstration Endpoints (Protected by Customer Auth)
router.post('/demo-simulate-success/:orderId', authenticate, simulateDemoSuccess);
router.post('/demo-simulate-failure/:orderId', authenticate, simulateDemoFailure);

export default router;

