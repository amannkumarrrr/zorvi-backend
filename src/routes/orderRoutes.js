import express from 'express';
import {
  getMyOrders,
  getOrderById,
  cancelOrder,
  getAdminOrders,
  updateOrderStatus,
} from '../controllers/orderController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

router.use(authenticate);

// Admin order management endpoints
router.get('/admin', authorize('admin'), getAdminOrders);
router.patch('/admin/:id/status', authorize('admin'), updateOrderStatus);

// Customer order endpoints
router.get('/my-orders', getMyOrders);
router.get('/:id', getOrderById);
router.post('/:id/cancel', cancelOrder);

export default router;
