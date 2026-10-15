import Review from '../models/Review.js';
import Order from '../models/Order.js';

/**
 * GET /api/reviews/product/:productId
 * Retrieve all reviews & aggregated rating stats for a product
 */
export const getProductReviews = async (req, res, next) => {
  try {
    const { productId } = req.params;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required.',
      });
    }

    const reviews = await Review.find({ productId: String(productId) })
      .sort({ createdAt: -1 })
      .lean();

    // Compute stats
    const totalReviews = reviews.length;
    let sumRating = 0;
    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach((r) => {
      sumRating += r.rating;
      const rounded = Math.round(r.rating);
      if (ratingDistribution[rounded] !== undefined) {
        ratingDistribution[rounded] += 1;
      }
    });

    const averageRating = totalReviews > 0 ? Number((sumRating / totalReviews).toFixed(1)) : 0;

    res.status(200).json({
      success: true,
      data: {
        reviews,
        stats: {
          totalReviews,
          averageRating,
          ratingDistribution,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/reviews/product/:productId
 * Submit a rating and written review (authenticated users only)
 */
export const createProductReview = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { rating, title = '', comment } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required.',
      });
    }

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid rating between 1 and 5 stars.',
      });
    }

    if (!comment || comment.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Please write a review comment with at least 5 characters.',
      });
    }

    // Check for duplicate review by this user for this product
    const existingReview = await Review.findOne({
      productId: String(productId),
      userId: req.user._id,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a review for this product.',
      });
    }

    // Check if user has a qualifying completed purchase for "Verified Purchase" badge
    const qualifyingOrder = await Order.findOne({
      userId: req.user._id,
      orderStatus: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] },
      $or: [
        { 'items.productId': productId },
        { 'items._id': productId },
      ],
    });

    const isVerifiedPurchase = Boolean(qualifyingOrder);

    const review = await Review.create({
      productId: String(productId),
      userId: req.user._id,
      userName: req.user.name || 'AURA Customer',
      userEmail: req.user.email,
      rating: numRating,
      title: title.trim(),
      comment: comment.trim(),
      isVerifiedPurchase,
    });

    res.status(201).json({
      success: true,
      message: isVerifiedPurchase
        ? 'Thank you! Your verified purchase review has been published.'
        : 'Thank you! Your customer review has been published.',
      data: { review },
    });
  } catch (error) {
    // Handle MongoDB duplicate key error gracefully
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a review for this product.',
      });
    }
    next(error);
  }
};

/**
 * DELETE /api/reviews/:id
 * Delete a review (owner or admin only)
 */
export const deleteReview = async (req, res, next) => {
  try {
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found.',
      });
    }

    const isOwner = review.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this review.',
      });
    }

    await Review.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getProductReviews,
  createProductReview,
  deleteReview,
};
