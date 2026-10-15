import express from 'express';
import { uploadImage, uploadMultiple } from '../controllers/uploadController.js';
import { uploadSingleImage, uploadMultipleImages } from '../middleware/uploadMiddleware.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

// Admin only routes for uploading product assets to Cloudinary
router.use(authenticate, authorize('admin'));

router.post('/image', uploadSingleImage, uploadImage);
router.post('/images', uploadMultipleImages, uploadMultiple);

export default router;
