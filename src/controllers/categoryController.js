import Category from '../models/Category.js';
import Product from '../models/Product.js';

/**
 * GET /api/categories
 * Retrieve all active categories
 */
export const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      message: 'Categories retrieved successfully',
      data: {
        categories,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/categories/:slug/products
 * Retrieve products belonging to a specific category
 */
export const getProductsByCategory = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 12 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      isActive: true,
      category: slug.trim().toLowerCase(),
    };

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ rating: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      message: `Products for category "${slug}" retrieved successfully`,
      data: {
        category: slug,
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
