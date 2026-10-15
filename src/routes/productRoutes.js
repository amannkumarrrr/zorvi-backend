import express from 'express';
import { getProducts, getProductById } from '../controllers/productController.js';
import { validate } from '../middleware/validate.js';
import { queryProductsSchema } from '../utils/validators.js';

const router = express.Router();

router.get('/', validate(queryProductsSchema), getProducts);
router.get('/:id', getProductById);

export default router;
