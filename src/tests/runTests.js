import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import crypto from 'crypto';
import app from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import SignupVerification from '../models/SignupVerification.js';

let server;
const PORT = 5099; // Test port to avoid conflict with dev server
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

const runAllTests = async () => {
  console.log('\n--- STARTING AURA COMMERCE PHASE 3 BACKEND TEST SUITE ---\n');

  try {
    // 1. Connect DB and start test server
    await mongoose.connect(process.env.MONGODB_URI);
    server = app.listen(PORT);
    console.log(`[Test Server] Listening on port ${PORT}\n`);

    const timestamp = Date.now();
    const testCustomerEmail = `phase3_customer_${timestamp}@test.com`;
    const testCustomerPassword = 'SecurePassword123!';
    let customerCookie = '';
    let customerToken = '';

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    let adminCookie = '';
    let adminToken = '';

    let testProductId = '';
    let initialProductStock = 50;
    let codOrderId = '';
    let razorpayDbOrderId = '';
    let razorpayGatewayOrderId = '';

    // Test 1: Health Check
    await test('1. Health check returns 200 OK for Phase 3 API', async () => {
      const res = await fetch(`${BASE_URL}/health`);
      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.success === true, 'Expected success === true');
      assert(data.message.includes('Phase 3'), `Expected Phase 3 message, got: ${data.message}`);
    });

    // Test 2: Customer Registration & Auth with Verified Signup Token
    await test('2. Customer registration enforces email verification and creates account with JWT session', async () => {
      // 2a. Direct registration without signupToken fails with 400
      const unverifiedRes = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Phase3 Shopper',
          email: testCustomerEmail,
          password: testCustomerPassword,
        }),
      });
      assert(unverifiedRes.status === 400, `Expected 400 without signupToken, got ${unverifiedRes.status}`);

      // 2b. Verified registration with valid signupToken succeeds with 201
      const signupToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto
        .createHmac('sha256', process.env.JWT_SECRET || 'aura_reset_secret_key')
        .update(signupToken)
        .digest('hex');

      await SignupVerification.create({
        email: testCustomerEmail.toLowerCase(),
        verified: true,
        signupTokenHash: tokenHash,
        signupTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        resendAvailableAt: new Date(),
      });

      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Phase3 Shopper',
          email: testCustomerEmail,
          password: testCustomerPassword,
          signupToken,
        }),
      });

      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        customerCookie = setCookie.split(';')[0];
      }

      const data = await res.json();
      assert(res.status === 201, `Expected 201, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      customerToken = data.data.token;
    });

    // Test 3: Admin Login
    await test('3. Admin login succeeds with admin privileges', async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail,
          password: adminPassword,
        }),
      });

      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        adminCookie = setCookie.split(';')[0];
      }

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}: ${data.message}`);
      assert(data.data.user.role === 'admin', 'User must have admin role');
      adminToken = data.data.token;
    });

    // Test 4: Create a dedicated test product for inventory tracking
    await test('4. Admin creates test product for cart & checkout tests', async () => {
      const res = await fetch(`${BASE_URL}/admin/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          title: `Phase3 Test Headphones ${timestamp}`,
          description: 'High fidelity audio headphones for test checkout',
          category: 'laptops',
          brand: 'AURA Audio',
          price: 50.0, // $50 = ₹4000
          discountPercentage: 0,
          thumbnail: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
          stock: initialProductStock,
          sku: `P3-HEAD-${timestamp}`,
        }),
      });

      const data = await res.json();
      assert(res.status === 201, `Expected 201, got ${res.status}: ${data.message}`);
      assert(data.data.product._id, 'Product ID must exist');
      testProductId = data.data.product._id;
    });

    // Test 5: Add Item to User Cart (POST /api/cart/items)
    await test('5. Add item to user persistent cart (POST /api/cart/items)', async () => {
      const res = await fetch(`${BASE_URL}/cart/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          productId: testProductId,
          quantity: 2,
        }),
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      assert(data.data.totalItems === 2, `Expected 2 items, got ${data.data.totalItems}`);
      assert(data.data.subtotalINR === 8000, `Expected ₹8000 subtotal, got ${data.data.subtotalINR}`);
    });

    // Test 6: Retrieve User Cart (GET /api/cart)
    await test('6. Fetch persistent cart with calculated delivery fee (GET /api/cart)', async () => {
      const res = await fetch(`${BASE_URL}/cart`, {
        headers: {
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.data.items.length === 1, 'Expected 1 item type in cart');
      assert(data.data.subtotalINR === 8000, 'Subtotal should be ₹8000');
      // Over ₹999 threshold -> delivery fee should be 0
      assert(data.data.deliveryFeeINR === 0, 'Expected free delivery over ₹999');
    });

    // Test 7: Update Cart Item Quantity (PATCH /api/cart/items/:id)
    await test('7. Update cart item quantity (PATCH /api/cart/items/:id)', async () => {
      const res = await fetch(`${BASE_URL}/cart/items/${testProductId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          quantity: 3,
        }),
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.data.totalItems === 3, `Expected totalItems === 3, got ${data.data.totalItems}`);
      assert(data.data.subtotalINR === 12000, `Expected ₹12000, got ${data.data.subtotalINR}`);
    });

    // Test 8: Place COD Order (POST /api/payments/create-order)
    await test('8. Place Cash on Delivery (COD) order with authoritative pricing', async () => {
      const res = await fetch(`${BASE_URL}/payments/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          paymentMethod: 'cod',
          shippingAddress: {
            fullName: 'Test Customer',
            email: testCustomerEmail,
            phone: '9876543210',
            address: '42 Marine Drive',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400020',
          },
          couponCode: 'AURA10',
        }),
      });

      const data = await res.json();
      assert(res.status === 201, `Expected 201, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      assert(data.data.order.paymentMethod === 'cod', 'Payment method must be cod');
      assert(
        data.data.order.discountINR === 1000 || data.data.order.discountINR === 1200,
        `Expected discount, got ${data.data.order.discountINR}`
      );
      assert(
        data.data.order.totalAmountINR === 12000 - data.data.order.discountINR,
        `Expected total ₹${12000 - data.data.order.discountINR}, got ${data.data.order.totalAmountINR}`
      );
      codOrderId = data.data.order._id;
    });

    // Test 9: Verify Atomic Inventory Deduction for COD Order
    await test('9. Inventory was atomically decremented by 3 units', async () => {
      const updatedProduct = await Product.findById(testProductId);
      assert(updatedProduct.stock === initialProductStock - 3, `Expected stock ${initialProductStock - 3}, got ${updatedProduct.stock}`);
    });

    // Test 10: Verify Cart was Cleared After Checkout
    await test('10. User cart is cleared after successful order placement', async () => {
      const cart = await Cart.findOne({ userId: (await User.findOne({ email: testCustomerEmail }))._id });
      assert(cart.items.length === 0, `Expected 0 cart items, got ${cart.items.length}`);
    });

    // Test 11: Customer Order History (GET /api/orders/my-orders)
    await test('11. Customer order history includes the newly placed COD order', async () => {
      const res = await fetch(`${BASE_URL}/orders/my-orders`, {
        headers: {
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.data.orders.length >= 1, 'Expected at least 1 order');
      assert(data.data.orders[0]._id === codOrderId, 'Order ID must match');
    });

    // Test 12: Customer Cancel Order Restores Inventory (POST /api/orders/:id/cancel)
    await test('12. Cancelling COD order restores deducted stock to inventory', async () => {
      const res = await fetch(`${BASE_URL}/orders/${codOrderId}/cancel`, {
        method: 'POST',
        headers: {
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}: ${data.message}`);
      assert(data.data.order.orderStatus === 'cancelled', 'Status must be cancelled');

      const restoredProduct = await Product.findById(testProductId);
      assert(restoredProduct.stock === initialProductStock, `Expected stock restored to ${initialProductStock}, got ${restoredProduct.stock}`);
    });

    // Test 13: Initiate Online Razorpay Payment (POST /api/payments/create-order)
    await test('13. Initiate Razorpay order with test credentials', async () => {
      // First re-add 1 item to cart
      await fetch(`${BASE_URL}/cart/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          productId: testProductId,
          quantity: 1,
        }),
      });

      const res = await fetch(`${BASE_URL}/payments/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          paymentMethod: 'razorpay',
          shippingAddress: {
            fullName: 'Test Shopper',
            email: testCustomerEmail,
            phone: '9876543210',
            address: '100 MG Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
        }),
      });

      const data = await res.json();
      assert(res.status === 201, `Expected 201, got ${res.status}: ${data.message}`);
      assert(data.success === true, 'Expected success === true');
      assert(data.data.razorpayOrder.id.startsWith('order_'), 'Expected valid Razorpay order id');
      assert(data.data.razorpayOrder.amount === 400000, `Expected 400000 paise (₹4000), got ${data.data.razorpayOrder.amount}`);

      razorpayDbOrderId = data.data.order._id;
      razorpayGatewayOrderId = data.data.razorpayOrder.id;
    });

    // Test 14: Verify Cryptographic Payment Signature (POST /api/payments/verify)
    await test('14. Verify authentic Razorpay payment signature & confirm order', async () => {
      const mockPaymentId = `pay_mock_${timestamp}`;
      const validSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpayGatewayOrderId}|${mockPaymentId}`)
        .digest('hex');

      const res = await fetch(`${BASE_URL}/payments/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          razorpayOrderId: razorpayGatewayOrderId,
          razorpayPaymentId: mockPaymentId,
          razorpaySignature: validSignature,
        }),
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}: ${data.message}`);
      assert(data.data.order.paymentStatus === 'paid', 'Payment status must be paid');
      assert(data.data.order.orderStatus === 'confirmed', 'Order status must be confirmed');
    });

    // Test 15: Invalid Payment Signature is Rejected (400)
    await test('15. Invalid Razorpay signature is rejected with 400 Bad Request', async () => {
      const res = await fetch(`${BASE_URL}/payments/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: customerCookie,
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          razorpayOrderId: razorpayGatewayOrderId,
          razorpayPaymentId: 'pay_fraudulent_123',
          razorpaySignature: 'invalid_tampered_signature_hex_value',
        }),
      });

      const data = await res.json();
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(data.success === false, 'Expected success === false');
    });

    // Test 16: Admin List All Orders (GET /api/orders/admin)
    await test('16. Admin can list all customer orders with pagination', async () => {
      const res = await fetch(`${BASE_URL}/orders/admin?page=1&limit=10`, {
        headers: {
          Cookie: adminCookie,
          Authorization: `Bearer ${adminToken}`,
        },
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(data.data.orders), 'Orders must be an array');
      assert(data.data.orders.length >= 2, 'Expected at least 2 orders in DB');
    });

    // Test 17: Admin Update Order Status & Tracking (PATCH /api/admin/orders/:id/status)
    await test('17. Admin can update order status to "shipped" with tracking number', async () => {
      const res = await fetch(`${BASE_URL}/admin/orders/${razorpayDbOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          orderStatus: 'shipped',
          trackingInformation: `BLUEDART-IND-${timestamp}`,
        }),
      });

      const data = await res.json();
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(data.data.order.orderStatus === 'shipped', 'Order status must be shipped');
      assert(data.data.order.trackingInformation.includes('BLUEDART'), 'Tracking info must be saved');
    });

    // Clean up created test resources
    await User.deleteOne({ email: testCustomerEmail });
    await Product.deleteOne({ _id: testProductId });
    await Order.deleteMany({ _id: { $in: [codOrderId, razorpayDbOrderId] } });
    await Cart.deleteOne({ userId: (await User.findOne({ email: testCustomerEmail }))?._id });

    console.log('\n--- TEST SUMMARY ---');
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`Passed: ${passedCount} / ${results.length}`);
    if (passedCount === results.length) {
      console.log('ALL PHASE 3 TESTS PASSED SUCCESSFULLY! 🚀\n');
    } else {
      console.error('SOME TESTS FAILED!\n');
    }
  } catch (error) {
    console.error('Fatal test harness error:', error);
  } finally {
    if (server) server.close();
    await mongoose.connection.close();
    process.exit(results.every((r) => r.passed) ? 0 : 1);
  }
};

runAllTests();
