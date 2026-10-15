import express from 'express';
import { getCategories, getProductsByCategory } from '../controllers/categoryController.js';
import { validate } from '../middleware/validate.js';
import { categorySlugSchema } from '../utils/validators.js';

const router = express.Router();

router.get('/', getCategories);
router.get('/:slug/products', validate(categorySlugSchema), getProductsByCategory);

export default router;
