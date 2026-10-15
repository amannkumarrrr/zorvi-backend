import mongoose from 'mongoose';
import Product from '../models/Product.js';

/**
 * GET /api/products
 * Public paginated product catalog with search, filter, and sort
 */
export const getProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 12, q, category, minPrice, maxPrice, sortBy = 'default' } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Build filter query
    const filter = { isActive: true };

    // Search query
    if (q && q.trim()) {
      const searchTerm = q.trim();
      // Use regex for partial matching across title, brand, and category
      filter.$or = [
        { title: { $regex: searchTerm, $options: 'i' } },
        { brand: { $regex: searchTerm, $options: 'i' } },
        { category: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
      ];
    }

    // Category filter
    if (category && category !== 'all' && category.trim()) {
      filter.category = category.trim().toLowerCase();
    }

    // Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};
      if (minPrice !== undefined && !isNaN(minPrice)) {
        filter.price.$gte = Number(minPrice);
      }
      if (maxPrice !== undefined && !isNaN(maxPrice)) {
        filter.price.$lte = Number(maxPrice);
      }
    }

    // Sorting
    let sortOption = { createdAt: -1 };
    switch (sortBy) {
      case 'price-asc':
        sortOption = { price: 1 };
        break;
      case 'price-desc':
        sortOption = { price: -1 };
        break;
      case 'rating-desc':
        sortOption = { rating: -1 };
        break;
      case 'title-asc':
        sortOption = { title: 1 };
        break;
      case 'newest':
        sortOption = { createdAt: -1 };
        break;
      default:
        sortOption = { rating: -1, createdAt: -1 };
        break;
    }

    // Execute queries in parallel
    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/products/:id
 * Retrieve a single product by MongoDB ObjectId or externalId
 */
export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;

    let product = null;

    // Check if ID is a valid MongoDB ObjectId
    if (mongoose.Types.ObjectId.isValid(id)) {
      product = await Product.findOne({ _id: id, isActive: true }).lean();
    }

    // If not found by ObjectId, check externalId
    if (!product && !isNaN(id)) {
      product = await Product.findOne({ externalId: Number(id), isActive: true }).lean();
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product #${id} not found or is currently inactive.`,
        errors: [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Product retrieved successfully',
      data: {
        product,
      },
    });
  } catch (error) {
    next(error);
  }
};
