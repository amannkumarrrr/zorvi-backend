import express from 'express';
import {
  getCart,
  addItemToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  mergeGuestCart,
} from '../controllers/cartController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All cart endpoints require an authenticated user
router.use(authenticate);

router.get('/', getCart);
router.post('/items', addItemToCart);
router.patch('/items/:productId', updateCartItem);
router.delete('/items/:productId', removeCartItem);
router.delete('/', clearCart);
router.post('/merge', mergeGuestCart);

export default router;
