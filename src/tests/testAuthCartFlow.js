import axios from 'axios';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE_URL = 'http://localhost:5001/api';

const runScenarioTests = async () => {
  console.log('\n--- VERIFYING AUTHENTICATION & CART FLOW SCENARIOS ---');

  // Connect to DB for verification
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB Atlas for state assertions\n');

  let passed = 0;
  let total = 0;

  const assert = (condition, description) => {
    total++;
    if (condition) {
      console.log(`  [PASS] ${total}. ${description}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${total}. ${description}`);
      throw new Error(`Assertion failed: ${description}`);
    }
  };

  const clientUnauth = axios.create({ baseURL: BASE_URL, validateStatus: () => true });

  // SCENARIO 1 & 4: Unauthenticated user accesses cart API -> rejected with 401
  const resCartUnauth = await clientUnauth.get('/cart');
  assert(resCartUnauth.status === 401, 'Unauthenticated GET /api/cart returns HTTP 401 Unauthorized');
  assert(resCartUnauth.data.message.includes('Authentication required') || resCartUnauth.data.message.includes('log in'), 'Returns clear login-required message for unauthenticated cart access');

  // SCENARIO 2 & 4: Unauthenticated user adds to cart -> rejected with 401
  const resAddUnauth = await clientUnauth.post('/cart/items', { productId: '99', quantity: 1 });
  assert(resAddUnauth.status === 401, 'Unauthenticated POST /api/cart/items returns HTTP 401 Unauthorized');

  // SCENARIO 4: Unauthenticated user places order -> rejected with 401
  const resOrderUnauth = await clientUnauth.post('/payments/create-order', {
    shippingAddress: {
      fullName: 'Guest User',
      email: 'guest@example.com',
      phone: '9876543210',
      address: '123 Guest St',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    },
    paymentMethod: 'cod',
  });
  assert(resOrderUnauth.status === 401, 'Unauthenticated POST /api/payments/create-order returns HTTP 401 Unauthorized');

  // Find a sample product in DB
  const sampleProduct = await Product.findOne({ isActive: true });
  assert(Boolean(sampleProduct), 'Found active product in database for flow testing');

  const formatCookie = (setCookieHeader) => {
    if (!setCookieHeader) return '';
    if (Array.isArray(setCookieHeader)) {
      return setCookieHeader.map((c) => c.split(';')[0]).join('; ');
    }
    return setCookieHeader.split(';')[0];
  };

  // Register User A
  const timestamp = Date.now();
  const userAData = {
    name: 'Customer Alice',
    email: `alice_${timestamp}@test.com`,
    password: 'Password123!',
  };
  const clientA = axios.create({ baseURL: BASE_URL, validateStatus: () => true });
  const regARes = await clientA.post('/auth/register', userAData);
  assert(regARes.status === 201, 'User A (Alice) registered successfully');
  const cookieA = formatCookie(regARes.headers['set-cookie']);
  clientA.defaults.headers.Cookie = cookieA;

  // SCENARIO 5: Logged-in User A can add, update, and remove cart items
  const addARes = await clientA.post('/cart/items', { productId: sampleProduct.externalId || sampleProduct._id, quantity: 2 });
  assert(addARes.status === 200, 'User A can add product to persistent cart');

  const getCartARes = await clientA.get('/cart');
  assert(getCartARes.status === 200 && getCartARes.data.data.items.length === 1, 'User A cart contains added product');
  assert(getCartARes.data.data.items[0].quantity === 2, 'User A cart reflects quantity of 2');

  const updateARes = await clientA.patch(`/cart/items/${sampleProduct.externalId || sampleProduct._id}`, { quantity: 3 });
  assert(updateARes.status === 200, 'User A can update cart item quantity to 3');

  const getUpdatedCartA = await clientA.get('/cart');
  assert(getUpdatedCartA.data.data.items[0].quantity === 3, 'User A cart reflects updated quantity of 3');

  // SCENARIO 6: Logged-in User A places demo order
  const orderARes = await clientA.post('/payments/create-order', {
    shippingAddress: {
      fullName: 'Alice Customer',
      email: userAData.email,
      phone: '9876543210',
      address: '456 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    paymentMethod: 'cod',
  });
  assert(orderARes.status === 201, 'User A placed demo COD order successfully');
  const userAOrderId = orderARes.data.data.order._id;

  const cartAfterOrderA = await clientA.get('/cart');
  assert(cartAfterOrderA.data.data.items.length === 0, 'User A cart is cleared after order placement');

  // User A adds another item to cart before logout
  await clientA.post('/cart/items', { productId: sampleProduct.externalId || sampleProduct._id, quantity: 1 });

  // SCENARIO 7: Log out User A and sign in as User B -> User B NEVER sees User A's cart
  const userBData = {
    name: 'Customer Bob',
    email: `bob_${timestamp}@test.com`,
    password: 'Password123!',
  };
  const clientB = axios.create({ baseURL: BASE_URL, validateStatus: () => true });
  const regBRes = await clientB.post('/auth/register', userBData);
  assert(regBRes.status === 201, 'User B (Bob) registered successfully');
  const cookieB = formatCookie(regBRes.headers['set-cookie']);
  clientB.defaults.headers.Cookie = cookieB;

  const cartBRes = await clientB.get('/cart');
  assert(cartBRes.data.data.items.length === 0, 'User B has an isolated empty cart; User A cart is not exposed');

  // SCENARIO 3: User B tries to view or cancel User A's order by changing the ID in the URL
  const viewOtherOrderRes = await clientB.get(`/orders/${userAOrderId}`);
  assert(viewOtherOrderRes.status === 403, 'User B cannot view User A order by URL ID (HTTP 403 Forbidden)');

  const cancelOtherOrderRes = await clientB.post(`/orders/${userAOrderId}/cancel`);
  assert(cancelOtherOrderRes.status === 403, 'User B cannot cancel User A order by URL ID (HTTP 403 Forbidden)');

  // SCENARIO 8: Refreshing preserves authentication and user cart
  const refreshRes = await clientA.get('/auth/me');
  assert(refreshRes.status === 200 && refreshRes.data.data.user.email === userAData.email, 'User A session is preserved via cookie on refresh');

  const refreshedCartA = await clientA.get('/cart');
  assert(refreshedCartA.data.data.items.length === 1, 'User A cart state is preserved accurately after refresh');

  // Clean up test data from DB
  await User.deleteMany({ email: { $in: [userAData.email, userBData.email] } });
  await Cart.deleteMany({ userId: { $in: [regARes.data.data.user.id, regBRes.data.data.user.id] } });
  await Order.deleteMany({ _id: userAOrderId });
  console.log('\n✓ Cleaned up temporary test users, carts, and orders');

  await mongoose.disconnect();

  console.log(`\nALL ${passed} / ${total} AUTHENTICATION & CART FLOW TESTS PASSED! 🎉\n`);
};

runScenarioTests().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
