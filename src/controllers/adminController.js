import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

/**
 * GET /api/admin/products
 * List products for admin with active and inactive status
 */
export const getAdminProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, q, category } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (category && category !== 'all') {
      filter.category = category.trim().toLowerCase();
    }
    if (q && q.trim()) {
      filter.$or = [
        { title: { $regex: q.trim(), $options: 'i' } },
        { brand: { $regex: q.trim(), $options: 'i' } },
        { sku: { $regex: q.trim(), $options: 'i' } },
      ];
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      message: 'Admin products inventory retrieved successfully',
      data: {
        products,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/products
 * Create a new product
 */
export const createProduct = async (req, res, next) => {
  try {
    const productData = req.body;

    // Check if category exists, if not create automatically or ensure lowercase
    const categorySlug = productData.category.trim().toLowerCase();
    let cat = await Category.findOne({ slug: categorySlug });
    if (!cat) {
      cat = await Category.create({
        name: productData.category.trim(),
        slug: categorySlug,
      });
    }

    const newProduct = await Product.create({
      ...productData,
      category: categorySlug,
      isDemoCatalog: false,
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: {
        product: newProduct,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/products/:id
 * Update an existing product
 */
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.category) {
      updates.category = updates.category.trim().toLowerCase();
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({
        success: false,
        message: `Product #${id} not found.`,
        errors: [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: {
        product: updatedProduct,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/products/:id
 * Soft delete / deactivate product
 */
export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    const deactivatedProduct = await Product.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!deactivatedProduct) {
      return res.status(404).json({
        success: false,
        message: `Product #${id} not found.`,
        errors: [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Product deactivated successfully',
      data: {
        product: deactivatedProduct,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/categories
 * Create a new category
 */
export const createCategory = async (req, res, next) => {
  try {
    const { name, slug, description, image } = req.body;
    const cleanSlug = slug.trim().toLowerCase();

    const existing = await Category.findOne({ slug: cleanSlug });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Category with slug "${cleanSlug}" already exists.`,
        errors: [{ field: 'slug', message: 'Category slug must be unique.' }],
      });
    }

    const category = await Category.create({
      name: name.trim(),
      slug: cleanSlug,
      description: description ? description.trim() : '',
      image: image || '',
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: {
        category,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/categories/:id
 */
export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.slug) {
      updates.slug = updates.slug.trim().toLowerCase();
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedCategory) {
      return res.status(404).json({
        success: false,
        message: `Category #${id} not found.`,
        errors: [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: {
        category: updatedCategory,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/categories/:id
 */
export const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const deactivatedCategory = await Category.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!deactivatedCategory) {
      return res.status(404).json({
        success: false,
        message: `Category #${id} not found.`,
        errors: [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Category deactivated successfully',
      data: {
        category: deactivatedCategory,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/stats
 * Admin dashboard business metrics & statistics
 */
export const getAdminStats = async (req, res, next) => {
  try {
    const [
      totalOrders,
      totalUsers,
      pendingOrders,
      completedOrders,
      processingOrders,
      cancelledOrders,
      revenueResult,
    ] = await Promise.all([
      Order.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Order.countDocuments({ orderStatus: 'pending' }),
      Order.countDocuments({ orderStatus: 'delivered' }),
      Order.countDocuments({ orderStatus: { $in: ['confirmed', 'processing', 'shipped'] } }),
      Order.countDocuments({ orderStatus: 'cancelled' }),
      Order.aggregate([
        {
          $match: {
            $or: [
              { paymentStatus: { $in: ['paid', 'paid_demo', 'Paid (Demo)'] } },
              { orderStatus: 'delivered' },
            ],
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmountINR' },
          },
        },
      ]),
    ]);

    const totalRevenueINR = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

    res.status(200).json({
      success: true,
      message: 'Admin dashboard statistics retrieved successfully',
      data: {
        totalOrders,
        totalUsers,
        pendingOrders,
        completedOrders,
        processingOrders,
        cancelledOrders,
        totalRevenueINR,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/customers
 * Admin list customer accounts with aggregated spend & order history
 */
export const getAdminCustomers = async (req, res, next) => {
  try {
    const { page = 1, limit = 15, q } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (q && q.trim()) {
      query.$or = [
        { name: { $regex: q.trim(), $options: 'i' } },
        { email: { $regex: q.trim(), $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
    ]);

    // Aggregate orders count and spend for these users
    const userIds = users.map((u) => u._id);
    const orderAggregates = await Order.aggregate([
      { $match: { userId: { $in: userIds } } },
      {
        $group: {
          _id: '$userId',
          orderCount: { $sum: 1 },
          totalSpentINR: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ['$paymentStatus', ['paid', 'paid_demo', 'Paid (Demo)']] },
                    { $eq: ['$orderStatus', 'delivered'] },
                  ],
                },
                '$totalAmountINR',
                0,
              ],
            },
          },
          lastOrderDate: { $max: '$createdAt' },
        },
      },
    ]);

    const aggMap = new Map();
    orderAggregates.forEach((agg) => {
      aggMap.set(agg._id.toString(), agg);
    });

    const customers = users.map((u) => {
      const agg = aggMap.get(u._id.toString()) || { orderCount: 0, totalSpentINR: 0, lastOrderDate: null };
      return {
        ...u,
        orderCount: agg.orderCount,
        totalSpentINR: agg.totalSpentINR,
        lastOrderDate: agg.lastOrderDate,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Admin customers retrieved successfully',
      data: {
        customers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
