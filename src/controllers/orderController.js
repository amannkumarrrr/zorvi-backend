import Order from '../models/Order.js';
import { restoreInventoryForOrder } from './paymentController.js';
import emailService from '../services/emailService.js';

/**
 * GET /api/orders/my-orders
 * Customer order history
 */
export const getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      message: 'Orders retrieved successfully',
      data: { orders },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/orders/:id
 * Retrieve order details (accessible by owner or admin)
 */
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id).lean();
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
        errors: [],
      });
    }

    // Authorization check: Owner or Admin
    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this order.',
        errors: [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Order retrieved successfully',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/orders/:id/cancel
 * Customer order cancellation
 */
export const cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
        errors: [],
      });
    }

    // Owner check
    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
        errors: [],
      });
    }

    // Eligibility check
    if (['shipped', 'delivered', 'cancelled'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be cancelled because it is already ${order.orderStatus}.`,
        errors: [],
      });
    }

    order.orderStatus = 'cancelled';
    await order.save();

    // Restore inventory atomically
    await restoreInventoryForOrder(order);

    res.status(200).json({
      success: true,
      message: 'Order has been cancelled successfully. Inventory restored.',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/orders
 * Admin list all orders with pagination & status filters
 */
export const getAdminOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, paymentStatus, q } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }
    if (paymentStatus && paymentStatus !== 'all') {
      filter.paymentStatus = paymentStatus;
    }
    if (q && q.trim()) {
      filter.$or = [
        { orderNumber: { $regex: q.trim(), $options: 'i' } },
        { 'shippingAddress.fullName': { $regex: q.trim(), $options: 'i' } },
        { 'shippingAddress.email': { $regex: q.trim(), $options: 'i' } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      message: 'Orders retrieved',
      data: {
        orders,
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

export const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/**
 * GET /api/admin/orders/:id
 * Admin retrieve full order details with customer order history
 */
export const getAdminOrderDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate('userId', 'name email phone createdAt').lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
        errors: [],
      });
    }

    const customerHistory = await Order.find({
      userId: order.userId?._id || order.userId,
      _id: { $ne: order._id },
    })
      .select('orderNumber createdAt totalAmountINR orderStatus paymentStatus paymentMethod items')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.status(200).json({
      success: true,
      message: 'Admin order details retrieved successfully',
      data: {
        order,
        customerHistory,
        allowedTransitions: ALLOWED_TRANSITIONS[order.orderStatus] || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/orders/:id/status
 * Admin update order status with state machine transition enforcement
 */
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { orderStatus, trackingInformation } = req.body;

    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid order status. Allowed: ${validStatuses.join(', ')}`,
        errors: [],
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
        errors: [],
      });
    }

    const previousStatus = order.orderStatus;

    // Validate state machine transitions
    if (orderStatus !== previousStatus) {
      const allowedNext = ALLOWED_TRANSITIONS[previousStatus] || [];
      if (!allowedNext.includes(orderStatus)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from "${previousStatus}" to "${orderStatus}". Allowed transitions: ${allowedNext.join(', ') || 'None (order has reached a terminal status)'}`,
          errors: [],
        });
      }
      order.orderStatus = orderStatus;
    }

    if (trackingInformation !== undefined) {
      order.trackingInformation = trackingInformation.trim();
    }

    await order.save();

    // If newly cancelled, restore inventory
    if (orderStatus === 'cancelled' && previousStatus !== 'cancelled') {
      await restoreInventoryForOrder(order);
    }

    // If shipped, trigger shipping email
    if (orderStatus === 'shipped' && previousStatus !== 'shipped') {
      emailService.sendOrderShipped(order, trackingInformation).catch(console.error);
    }

    res.status(200).json({
      success: true,
      message: `Order status updated to "${orderStatus}"`,
      data: {
        order,
        allowedTransitions: ALLOWED_TRANSITIONS[order.orderStatus] || [],
      },
    });
  } catch (error) {
    next(error);
  }
};
