import express from 'express';
import {
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  updateCategory,
  deleteCategory,
  getAdminStats,
  getAdminCustomers,
} from '../controllers/adminController.js';
import {
  getAdminOrders,
  getAdminOrderDetails,
  updateOrderStatus,
} from '../controllers/orderController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createProductSchema,
  updateProductSchema,
  createCategorySchema,
} from '../utils/validators.js';

const router = express.Router();

// Protect all admin routes with authentication and 'admin' role check
router.use(authenticate, authorize('admin'));

// Admin Dashboard Analytics & Business Metrics
router.get('/stats', getAdminStats);

// Admin Customer Management
router.get('/customers', getAdminCustomers);

// Admin Product Management
router.get('/products', getAdminProducts);
router.post('/products', validate(createProductSchema), createProduct);
router.patch('/products/:id', validate(updateProductSchema), updateProduct);
router.delete('/products/:id', deleteProduct);

// Admin Category Management
router.post('/categories', validate(createCategorySchema), createCategory);
router.patch('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Admin Order Management
router.get('/orders', getAdminOrders);
router.get('/orders/:id', getAdminOrderDetails);
router.patch('/orders/:id/status', updateOrderStatus);

export default router;

