import express from 'express';
import {
  getProductReviews,
  createProductReview,
  deleteReview,
} from '../controllers/reviewController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// Public: view product reviews
router.get('/product/:productId', getProductReviews);

// Protected: submit review
router.post('/product/:productId', authenticate, createProductReview);

// Protected: delete review (owner or admin)
router.delete('/:id', authenticate, deleteReview);

export default router;
