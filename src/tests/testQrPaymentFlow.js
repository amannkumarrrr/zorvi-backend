import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import crypto from 'crypto';
import app from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';

let server;
const PORT = 5098;
const BASE_URL = `http://localhost:${PORT}/api`;

const results = [];

const test = async (name, fn) => {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: err.message });
    console.error(`  [FAIL] ${name} -> ${err.message}`);
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

const runQrTests = async () => {
  console.log('\n--- STARTING AURA COMMERCE DYNAMIC UPI QR PAYMENT TEST SUITE ---\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    server = app.listen(PORT);
    console.log(`[Test Server] Running on port ${PORT}\n`);

    const timestamp = Date.now();
    const customerAEmail = `customerA_${timestamp}@test.com`;
    const customerBEmail = `customerB_${timestamp}@test.com`;
    const password = 'Password123!';

    let tokenA = '';
    let cookieA = '';
    let userAId = '';

    let tokenB = '';
    let cookieB = '';
    let userBId = '';

    let testProduct = null;
    let initialStock = 40;

    // 1. Health check
    await test('1. Test server responds on test port', async () => {
      const res = await fetch(`${BASE_URL}/health`);
      assert(res.status === 200, 'Expected 200 OK');
    });

    // 2. Register Customer A
    await test('2. Register Customer A', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Customer A',
          email: customerAEmail,
          password,
        }),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      const data = await res.json();
      tokenA = data.data.token;
      cookieA = res.headers.get('set-cookie')?.split(';')[0] || '';
      userAId = data.data.user._id;
      assert(tokenA, 'Expected token for Customer A');
      assert(userAId, 'Expected userAId');
    });

    // 3. Register Customer B
    await test('3. Register Customer B', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Customer B',
          email: customerBEmail,
          password,
        }),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      const data = await res.json();
      tokenB = data.data.token;
      cookieB = res.headers.get('set-cookie')?.split(';')[0] || '';
      userBId = data.data.user._id;
      assert(tokenB, 'Expected token for Customer B');
      assert(userBId, 'Expected userBId');
    });

    // 4. Create test product in DB
    await test('4. Setup test product with inventory', async () => {
      testProduct = await Product.create({
        title: `Aura UPI Test Smartwatch ${timestamp}`,
        slug: `aura-upi-test-smartwatch-${timestamp}`,
        description: 'High-end smartwatch for testing UPI QR code payments',
        price: 24.99, // ~₹1999
        category: 'electronics',
        brand: 'Aura',
        stock: initialStock,
        rating: 4.8,
        thumbnail: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300',
        images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600'],
        isActive: true,
      });
      assert(testProduct && testProduct._id, 'Product created');
    });

    // 5. Add product to Customer A cart
    await test('5. Customer A adds product to cart', async () => {
      const res = await fetch(`${BASE_URL}/cart/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
          Cookie: cookieA,
        },
        body: JSON.stringify({
          productId: testProduct._id.toString(),
          quantity: 2,
        }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const cartData = await res.json();
      assert(cartData.data.totalItems === 2, 'Cart has 2 items');
    });

    // 6. Test invalid payment method rejection
    await test('6. Rejects invalid payment method with 400', async () => {
      const res = await fetch(`${BASE_URL}/payments/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
          Cookie: cookieA,
        },
        body: JSON.stringify({
          shippingAddress: {
            fullName: 'Customer A',
            email: customerAEmail,
            phone: '9876543210',
            address: '123 Test Street',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
          },
          paymentMethod: 'crypto_wallet',
        }),
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    // 7. Test unauthenticated payment order creation
    await test('7. Rejects unauthenticated order creation with 401', async () => {
      const res = await fetch(`${BASE_URL}/payments/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingAddress: {
            fullName: 'Guest',
            email: 'guest@example.com',
            phone: '9876543210',
            address: '123 Road',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
          },
          paymentMethod: 'upi_qr',
        }),
      });
      assert(res.status === 401, `Expected 401, got ${res.status}`);
    });

    // 8. Test live UPI QR generation call with merchant account
    await test('8. Calling upi_qr catches inactive Razorpay feature gracefully without crashing', async () => {
      const res = await fetch(`${BASE_URL}/payments/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
          Cookie: cookieA,
        },
        body: JSON.stringify({
          shippingAddress: {
            fullName: 'Customer A',
            email: customerAEmail,
            phone: '9876543210',
            address: '123 Test Street',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
          },
          paymentMethod: 'upi_qr',
        }),
      });

      const data = await res.json();
      // Razorpay test credentials without Smart Collect feature activated returns qrUnavailable: true
      assert(
        (res.status === 400 && data.qrUnavailable === true) || res.status === 201,
        'Handled gracefully with qrUnavailable: true or 201'
      );

      // Verify that Customer A cart was preserved and NOT cleared!
      const cartRes = await fetch(`${BASE_URL}/cart`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
          Cookie: cookieA,
        },
      });
      const cartData = await cartRes.json();
      assert(
        cartData.data.items.length === 1,
        'Customer cart is preserved safely upon QR unavailability'
      );
    });

    // 9. Test Pending UPI QR Order creation & verification
    let pendingQrOrder = null;
    await test('9. Create pending upi_qr order and query qr-status', async () => {
      pendingQrOrder = await Order.create({
        orderNumber: `AUR-TEST-${timestamp}`,
        userId: userAId,
        items: [
          {
            productId: testProduct._id,
            titleSnapshot: testProduct.title,
            imageSnapshot: testProduct.thumbnail,
            unitPrice: testProduct.price,
            unitPriceINR: 1999,
            quantity: 2,
            lineTotalINR: 3998,
          },
        ],
        shippingAddress: {
          fullName: 'Customer A',
          email: customerAEmail,
          phone: '9876543210',
          address: '123 Test Street',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          country: 'India',
        },
        subtotalINR: 3998,
        discountINR: 0,
        shippingFeeINR: 0,
        totalAmountINR: 3998,
        totalAmountPaise: 399800,
        currency: 'INR',
        paymentMethod: 'upi_qr',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        razorpayQrId: `qr_mock_${timestamp}`,
        inventoryDeducted: false,
      });

      assert(pendingQrOrder && pendingQrOrder._id, 'Pending QR order created in DB');

      // Unauthenticated qr-status query -> 401
      const unauthRes = await fetch(`${BASE_URL}/payments/qr-status/${pendingQrOrder._id}`);
      assert(unauthRes.status === 401, 'Unauthenticated query rejected with 401');

      // Customer B (unauthorized) qr-status query -> 403
      const forbiddenRes = await fetch(`${BASE_URL}/payments/qr-status/${pendingQrOrder._id}`, {
        headers: {
          Authorization: `Bearer ${tokenB}`,
          Cookie: cookieB,
        },
      });
      assert(forbiddenRes.status === 403, 'Unauthorized access rejected with 403');

      // Customer A (owner) qr-status query -> 200
      const ownerRes = await fetch(`${BASE_URL}/payments/qr-status/${pendingQrOrder._id}`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
          Cookie: cookieA,
        },
      });
      assert(ownerRes.status === 200, `Owner query succeeded, got ${ownerRes.status}`);
      const ownerData = await ownerRes.json();
      assert(ownerData.success === true, 'Success is true');
      assert(ownerData.paid === false, 'Paid is false while pending');
      assert(ownerData.data.order.orderNumber === pendingQrOrder.orderNumber, 'Order matches');
    });

    // 10. Test Cancel QR Payment flow
    await test('10. Customer cancels QR payment safely without cart loss', async () => {
      // Customer B attempts to cancel Customer A's order -> 403
      const badCancel = await fetch(`${BASE_URL}/payments/cancel-payment/${pendingQrOrder._id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenB}`,
          Cookie: cookieB,
        },
      });
      assert(badCancel.status === 403, 'Non-owner cannot cancel order');

      // Customer A cancels own pending order
      const cancelRes = await fetch(`${BASE_URL}/payments/cancel-payment/${pendingQrOrder._id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          Cookie: cookieA,
        },
      });
      assert(cancelRes.status === 200, `Expected 200, got ${cancelRes.status}`);
      const cancelData = await cancelRes.json();
      assert(cancelData.success === true, 'Cancellation success is true');

      const updatedOrder = await Order.findById(pendingQrOrder._id);
      assert(updatedOrder.orderStatus === 'cancelled', 'Order status marked cancelled');
      assert(updatedOrder.paymentStatus === 'failed', 'Payment status marked failed');

      // Customer A cart remains intact
      const cartRes = await fetch(`${BASE_URL}/cart`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
          Cookie: cookieA,
        },
      });
      const cartData = await cartRes.json();
      assert(cartData.data.items.length === 1, 'Cart items safely preserved after cancellation');
    });

    // 11. Test Webhook signature verification and qr_code.credited fulfillment
    await test('11. Webhook verifies HMAC signature and confirms QR payment atomically', async () => {
      // Create a fresh pending order for webhook test
      const webhookQrId = `qr_live_${timestamp}`;
      const orderForWebhook = await Order.create({
        orderNumber: `AUR-WH-${timestamp}`,
        userId: userAId,
        items: [
          {
            productId: testProduct._id,
            titleSnapshot: testProduct.title,
            imageSnapshot: testProduct.thumbnail,
            unitPrice: testProduct.price,
            unitPriceINR: 1999,
            quantity: 2,
            lineTotalINR: 3998,
          },
        ],
        shippingAddress: {
          fullName: 'Customer A',
          email: customerAEmail,
          phone: '9876543210',
          address: '123 Test Street',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          country: 'India',
        },
        subtotalINR: 3998,
        discountINR: 0,
        shippingFeeINR: 0,
        totalAmountINR: 3998,
        totalAmountPaise: 399800,
        currency: 'INR',
        paymentMethod: 'upi_qr',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        razorpayQrId: webhookQrId,
        inventoryDeducted: false,
      });

      const initialProductStock = (await Product.findById(testProduct._id)).stock;

      const webhookPayload = {
        event: 'qr_code.credited',
        payload: {
          qr_code: {
            entity: {
              id: webhookQrId,
              status: 'paid',
            },
          },
          payment: {
            entity: {
              id: `pay_mock_${timestamp}`,
              amount: 399800,
              currency: 'INR',
              status: 'captured',
              method: 'upi',
            },
          },
        },
      };

      const rawPayload = JSON.stringify(webhookPayload);

      // Test 11a: Rejected with invalid signature
      const badSigRes = await fetch(`${BASE_URL}/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'invalid_forged_signature_123',
        },
        body: rawPayload,
      });
      assert(badSigRes.status === 400, 'Forged signature rejected with 400');

      // Test 11b: Valid HMAC signature using RAZORPAY_WEBHOOK_SECRET
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_123';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawPayload)
        .digest('hex');

      const validSigRes = await fetch(`${BASE_URL}/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': validSignature,
        },
        body: rawPayload,
      });
      assert(validSigRes.status === 200, `Expected 200, got ${validSigRes.status}`);

      // Verify DB updates
      const confirmedOrder = await Order.findById(orderForWebhook._id);
      assert(confirmedOrder.paymentStatus === 'paid', 'Order marked as paid');
      assert(confirmedOrder.orderStatus === 'confirmed', 'Order marked as confirmed');
      assert(confirmedOrder.razorpayQrStatus === 'paid', 'QR status marked paid');
      assert(confirmedOrder.inventoryDeducted === true, 'Inventory deducted flag set');

      // Verify stock was decremented by 2
      const updatedProduct = await Product.findById(testProduct._id);
      assert(
        updatedProduct.stock === initialProductStock - 2,
        `Stock correctly decremented from ${initialProductStock} to ${updatedProduct.stock}`
      );

      // Verify customer cart was cleared
      const cartAfterPayment = await Cart.findOne({ userId: userAId });
      assert(cartAfterPayment.items.length === 0, 'Customer cart cleared after successful payment');

      // Test 11c: Idempotency (replay webhook)
      const replayRes = await fetch(`${BASE_URL}/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': validSignature,
        },
        body: rawPayload,
      });
      assert(replayRes.status === 200, 'Replay webhook returns 200 OK');

      const recheckedProduct = await Product.findById(testProduct._id);
      assert(
        recheckedProduct.stock === updatedProduct.stock,
        'Inventory was NOT deducted a second time on webhook replay (idempotent)'
      );
    });

    // Clean up test data
    await User.deleteMany({ email: { $in: [customerAEmail, customerBEmail] } });
    if (testProduct) await Product.findByIdAndDelete(testProduct._id);
    await Order.deleteMany({ userId: { $in: [userAId, userBId] } });
    await Cart.deleteMany({ userId: { $in: [userAId, userBId] } });

    console.log('\n--- TEST SUMMARY ---');
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`Passed: ${passedCount} / ${results.length}`);

    if (passedCount === results.length) {
      console.log('ALL DYNAMIC UPI QR PAYMENT TESTS PASSED SUCCESSFULLY! 🚀\n');
    } else {
      console.error('SOME TESTS FAILED! ❌\n');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    await mongoose.disconnect();
  }
};

runQrTests();
