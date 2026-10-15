import Order from '../models/Order.js';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import razorpayService from '../services/razorpayService.js';
import emailService from '../services/emailService.js';
import QRCode from 'qrcode';

const toINR = (priceUSD) => Math.round(Number(priceUSD || 0) * 80);

/**
 * Atomic inventory deduction helper
 */
const deductInventoryForOrder = async (order) => {
  if (order.inventoryDeducted) {
    return; // Prevent duplicate deduction
  }

  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.productId, {
      $inc: { stock: -item.quantity },
    });
  }

  order.inventoryDeducted = true;
  await order.save();
};

/**
 * Atomic inventory restoration helper (for order cancellation)
 */
export const restoreInventoryForOrder = async (order) => {
  if (!order.inventoryDeducted) {
    return;
  }

  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.productId, {
      $inc: { stock: item.quantity },
    });
  }

  order.inventoryDeducted = false;
  await order.save();
};

/**
 * POST /api/payments/create-order
 * Authoritatively calculates order totals and creates COD or Razorpay payment order
 */
export const createOrder = async (req, res, next) => {
  try {
    const { shippingAddress, paymentMethod = 'cod', couponCode = null } = req.body;

    if (!shippingAddress || !shippingAddress.fullName || !shippingAddress.email || !shippingAddress.phone || !shippingAddress.address || !shippingAddress.pincode) {
      return res.status(400).json({
        success: false,
        message: 'Complete shipping address and contact details are required.',
        errors: [],
      });
    }

    if (!['cod', 'razorpay', 'upi_qr', 'demo_upi_qr'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method. Must be "cod", "razorpay", "upi_qr", or "demo_upi_qr".',
        errors: [],
      });
    }

    // Retrieve user's cart from DB
    const cart = await Cart.findOne({ userId: req.user._id }).populate('items.productId');
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your shopping cart is empty.',
        errors: [],
      });
    }

    // Authoritative item and price calculation
    const orderItems = [];
    let subtotalINR = 0;

    for (const item of cart.items) {
      const product = item.productId;
      if (!product || !product.isActive) {
        return res.status(400).json({
          success: false,
          message: `Item in cart is no longer available. Please update your cart.`,
          errors: [],
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.title}". Only ${product.stock} units available.`,
          errors: [],
        });
      }

      const unitPriceINR = toINR(product.price);
      const lineTotalINR = unitPriceINR * item.quantity;

      subtotalINR += lineTotalINR;

      orderItems.push({
        productId: product._id,
        titleSnapshot: product.title,
        imageSnapshot: product.thumbnail || product.images?.[0] || '',
        unitPrice: product.price,
        unitPriceINR,
        quantity: item.quantity,
        lineTotalINR,
      });
    }

    // Delivery calculation
    const shippingFeeINR = subtotalINR >= 999 ? 0 : 99;

    // Coupon discount calculation (authoritative verification from MongoDB)
    let discountINR = 0;
    let appliedCouponDoc = null;
    if (couponCode) {
      const cleanCode = couponCode.trim().toUpperCase();
      appliedCouponDoc = await Coupon.findOne({ code: cleanCode, isActive: true });

      if (appliedCouponDoc) {
        // Expiry check
        if (new Date() > new Date(appliedCouponDoc.expiryDate)) {
          return res.status(400).json({
            success: false,
            message: `Coupon "${cleanCode}" has expired.`,
            errors: [],
          });
        }
        // Min order check
        if (subtotalINR < appliedCouponDoc.minOrderValueINR) {
          return res.status(400).json({
            success: false,
            message: `Coupon "${cleanCode}" requires a minimum subtotal of ₹${appliedCouponDoc.minOrderValueINR}.`,
            errors: [],
          });
        }
        // Usage limit check
        if (appliedCouponDoc.usedCount >= appliedCouponDoc.usageLimit) {
          return res.status(400).json({
            success: false,
            message: `Coupon "${cleanCode}" has reached its maximum usage limit.`,
            errors: [],
          });
        }
        // Duplicate user check
        if (appliedCouponDoc.usedBy?.some((u) => u.toString() === req.user._id.toString())) {
          return res.status(400).json({
            success: false,
            message: `You have already redeemed coupon "${cleanCode}".`,
            errors: [],
          });
        }

        // Calculate discount
        if (appliedCouponDoc.discountType === 'percentage') {
          const rawDiscount = Math.round((subtotalINR * appliedCouponDoc.discountValue) / 100);
          discountINR = appliedCouponDoc.maxDiscountINR
            ? Math.min(appliedCouponDoc.maxDiscountINR, rawDiscount)
            : rawDiscount;
        } else {
          discountINR = Math.min(subtotalINR, appliedCouponDoc.discountValue);
        }
      } else {
        // Fallback default promotional coupons
        if (cleanCode === 'AURA10') {
          discountINR = Math.round((subtotalINR * 10) / 100);
        } else if (cleanCode === 'FIRST20') {
          discountINR = Math.round((subtotalINR * 20) / 100);
        } else if (cleanCode === 'FREESHIP') {
          discountINR = shippingFeeINR;
        } else if (cleanCode === 'FESTIVE500' && subtotalINR >= 2499) {
          discountINR = 500;
        } else {
          return res.status(400).json({
            success: false,
            message: `Invalid coupon code "${couponCode}".`,
            errors: [],
          });
        }
      }
    }

    const totalAmountINR = Math.max(0, subtotalINR - discountINR + shippingFeeINR);
    const totalAmountPaise = totalAmountINR * 100; // Razorpay requires integer paise

    // Unique readable order number
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const orderNumber = `AUR-${datePrefix}-${randomSuffix}`;

    // Handle CASH ON DELIVERY (COD)
    if (paymentMethod === 'cod') {
      const newOrder = await Order.create({
        orderNumber,
        userId: req.user._id,
        items: orderItems,
        shippingAddress: {
          fullName: shippingAddress.fullName.trim(),
          email: shippingAddress.email.trim().toLowerCase(),
          phone: shippingAddress.phone.trim(),
          address: shippingAddress.address.trim(),
          city: shippingAddress.city.trim(),
          state: shippingAddress.state.trim(),
          pincode: shippingAddress.pincode.trim(),
          country: shippingAddress.country || 'India',
          deliveryNotes: shippingAddress.deliveryNotes || '',
        },
        subtotalINR,
        discountINR,
        couponCode: couponCode ? couponCode.trim().toUpperCase() : null,
        shippingFeeINR,
        totalAmountINR,
        totalAmountPaise,
        currency: 'INR',
        paymentMethod: 'cod',
        paymentStatus: 'pending', // COD is pending until delivered
        orderStatus: 'confirmed',
        inventoryDeducted: false,
      });

      // Deduct inventory atomically
      await deductInventoryForOrder(newOrder);

      // Clear customer's cart
      await Cart.findOneAndUpdate({ userId: req.user._id }, { $set: { items: [] } });

      // Trigger email confirmation asynchronously
      emailService.sendOrderConfirmation(newOrder).catch(console.error);

      return res.status(201).json({
        success: true,
        message: 'COD order confirmed successfully',
        data: {
          order: newOrder,
        },
      });
    }

    // Handle ONLINE PAYMENT (RAZORPAY)
    if (paymentMethod === 'razorpay') {
      // 1. Create local order record with pending status
      const newOrder = await Order.create({
        orderNumber,
        userId: req.user._id,
        items: orderItems,
        shippingAddress: {
          fullName: shippingAddress.fullName.trim(),
          email: shippingAddress.email.trim().toLowerCase(),
          phone: shippingAddress.phone.trim(),
          address: shippingAddress.address.trim(),
          city: shippingAddress.city.trim(),
          state: shippingAddress.state.trim(),
          pincode: shippingAddress.pincode.trim(),
          country: shippingAddress.country || 'India',
          deliveryNotes: shippingAddress.deliveryNotes || '',
        },
        subtotalINR,
        discountINR,
        couponCode: couponCode ? couponCode.trim().toUpperCase() : null,
        shippingFeeINR,
        totalAmountINR,
        totalAmountPaise,
        currency: 'INR',
        paymentMethod: 'razorpay',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        inventoryDeducted: false,
      });

      // 2. Create Razorpay order via official SDK
      let razorpayOrder;
      try {
        razorpayOrder = await razorpayService.createOrder({
          amount: totalAmountPaise,
          currency: 'INR',
          receipt: orderNumber,
          notes: {
            localOrderId: newOrder._id.toString(),
            orderNumber,
            userId: req.user._id.toString(),
          },
        });
      } catch (rzpErr) {
        // If Razorpay API is down or invalid credentials, remove local pending record
        await Order.findByIdAndDelete(newOrder._id);
        return res.status(502).json({
          success: false,
          message: `Payment gateway error: ${rzpErr.message}`,
          errors: [],
        });
      }

      // Associate Razorpay order ID
      newOrder.razorpayOrderId = razorpayOrder.id;
      await newOrder.save();

      return res.status(201).json({
        success: true,
        message: 'Payment order initiated with Razorpay',
        data: {
          order: newOrder,
          razorpayOrder,
          keyId: process.env.RAZORPAY_KEY_ID,
        },
      });
    }

    // Handle DYNAMIC UPI QR CODE PAYMENT
    if (paymentMethod === 'upi_qr') {
      if (!razorpayService.isConfigured()) {
        return res.status(503).json({
          success: false,
          qrUnavailable: true,
          errorCode: 'RAZORPAY_CONFIG_MISSING',
          message:
            'Razorpay credentials are not configured. To enable live UPI QR payments, please configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the backend environment.',
          errors: [],
        });
      }

      // 1. Create local order record with pending status
      // (Preserve user cart and stock until payment is confirmed)
      const newOrder = await Order.create({
        orderNumber,
        userId: req.user._id,
        items: orderItems,
        shippingAddress: {
          fullName: shippingAddress.fullName.trim(),
          email: shippingAddress.email.trim().toLowerCase(),
          phone: shippingAddress.phone.trim(),
          address: shippingAddress.address.trim(),
          city: shippingAddress.city.trim(),
          state: shippingAddress.state.trim(),
          pincode: shippingAddress.pincode.trim(),
          country: shippingAddress.country || 'India',
          deliveryNotes: shippingAddress.deliveryNotes || '',
        },
        subtotalINR,
        discountINR,
        couponCode: couponCode ? couponCode.trim().toUpperCase() : null,
        shippingFeeINR,
        totalAmountINR,
        totalAmountPaise,
        currency: 'INR',
        paymentMethod: 'upi_qr',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        inventoryDeducted: false,
      });

      // 2. Generate Dynamic UPI QR Code via Razorpay
      let qrCode;
      try {
        qrCode = await razorpayService.createQrCode({
          amount: totalAmountPaise,
          orderNumber,
          notes: {
            localOrderId: newOrder._id.toString(),
            orderNumber,
            userId: req.user._id.toString(),
          },
          closeBySeconds: 900, // 15 mins validity
        });
      } catch (qrErr) {
        // Rollback local pending order record if QR generation fails
        await Order.findByIdAndDelete(newOrder._id);

        if (qrErr.isQrNotActivated) {
          return res.status(400).json({
            success: false,
            qrUnavailable: true,
            errorCode: 'RAZORPAY_QR_NOT_ACTIVATED',
            message: qrErr.message,
            errors: [],
          });
        }

        return res.status(502).json({
          success: false,
          message: `QR code generation failed: ${qrErr.message}`,
          errors: [],
        });
      }

      // 3. Save QR metadata on order
      newOrder.razorpayQrId = qrCode.id;
      newOrder.razorpayQrImageUrl = qrCode.image_url || null;
      newOrder.razorpayQrStatus = qrCode.status || 'active';
      newOrder.qrExpiresAt = qrCode.close_by ? new Date(qrCode.close_by * 1000) : null;
      await newOrder.save();

      return res.status(201).json({
        success: true,
        message: 'Dynamic UPI QR code generated successfully',
        data: {
          order: newOrder,
          qrCode: {
            id: qrCode.id,
            imageUrl: qrCode.image_url || null,
            status: qrCode.status || 'active',
            closeBy: qrCode.close_by,
            amountINR: totalAmountINR,
            amountPaise: totalAmountPaise,
          },
        },
      });
    }

    // Handle DEMO UPI QR CODE PAYMENT (College Demonstration Mode)
    if (paymentMethod === 'demo_upi_qr') {
      // 1. Create local order record with pending demo status
      // (Preserve user cart and stock until explicit simulated payment or confirmation)
      const newOrder = await Order.create({
        orderNumber,
        userId: req.user._id,
        items: orderItems,
        shippingAddress: {
          fullName: shippingAddress.fullName.trim(),
          email: shippingAddress.email.trim().toLowerCase(),
          phone: shippingAddress.phone.trim(),
          address: shippingAddress.address.trim(),
          city: shippingAddress.city.trim(),
          state: shippingAddress.state.trim(),
          pincode: shippingAddress.pincode.trim(),
          country: shippingAddress.country || 'India',
          deliveryNotes: shippingAddress.deliveryNotes || '',
        },
        subtotalINR,
        discountINR,
        couponCode: couponCode ? couponCode.trim().toUpperCase() : null,
        shippingFeeINR,
        totalAmountINR,
        totalAmountPaise,
        currency: 'INR',
        paymentMethod: 'demo_upi_qr',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        isDemoPayment: true,
        inventoryDeducted: false,
        demoPaymentRef: orderNumber,
        demoPaymentNote: 'College Demo Payment — Not Real',
        qrExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins validity
      });

      // 2. Generate dynamic QR code with qrcode library
      // Clearly labeled demo URI / payload (never claiming to be a real bank transaction)
      const demoPayload = `upi://pay-demo?pa=demo.aura@college.internal&pn=Aura+Commerce+Demo&tr=${orderNumber}&am=${totalAmountINR}&cu=INR&mode=DEMO_COLLEGE_PROJECT&note=Demo+Payment+Not+Real`;

      let qrDataUrl = '';
      try {
        qrDataUrl = await QRCode.toDataURL(demoPayload, {
          width: 320,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });
      } catch (err) {
        console.error('[QRCode] Error generating demo QR:', err);
      }

      newOrder.demoQrDataUrl = qrDataUrl;
      newOrder.demoPayload = demoPayload;
      await newOrder.save();

      return res.status(201).json({
        success: true,
        message: 'Demo UPI QR code generated dynamically',
        data: {
          order: newOrder,
          qrCode: {
            id: newOrder._id,
            imageUrl: qrDataUrl,
            payload: demoPayload,
            amountINR: totalAmountINR,
            amountPaise: totalAmountPaise,
            isDemo: true,
            label: 'Demo Payment — Not Real',
            orderNumber,
            closeBy: Math.floor(Date.now() / 1000) + 900,
          },
        },
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/payments/verify
 * Verifies Razorpay payment signature and confirms order
 */
export const verifyPayment = async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required payment verification identifiers.',
        errors: [],
      });
    }

    // 1. Verify Cryptographic Signature
    const isValid = razorpayService.verifyPaymentSignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature. Verification failed.',
        errors: [],
      });
    }

    // 2. Find matching local order
    const order = await Order.findOne({ razorpayOrderId });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order associated with Razorpay Order ID "${razorpayOrderId}" not found.`,
        errors: [],
      });
    }

    // 2.1 Verify order ownership
    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
        errors: [],
      });
    }

    // Idempotent processing: if already paid, return immediately
    if (order.paymentStatus === 'paid') {
      return res.status(200).json({
        success: true,
        message: 'Payment was already verified and confirmed.',
        data: { order },
      });
    }

    // 3. Mark payment as paid and confirm order
    order.paymentStatus = 'paid';
    order.orderStatus = 'confirmed';
    order.razorpayPaymentId = razorpayPaymentId;
    order.razorpaySignature = razorpaySignature;
    await order.save();

    // 4. Deduct inventory atomically
    await deductInventoryForOrder(order);

    // 5. Clear customer's cart
    await Cart.findOneAndUpdate({ userId: order.userId }, { $set: { items: [] } });

    // 6. Send confirmation email
    emailService.sendOrderConfirmation(order).catch(console.error);

    res.status(200).json({
      success: true,
      message: 'Payment verified and order confirmed successfully!',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/payments/qr-status/:orderId
 * Checks status of UPI QR payment with Razorpay and/or local DB
 */
export const getQrPaymentStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const query = orderId.startsWith('AUR-') ? { orderNumber: orderId } : { _id: orderId };
    const order = await Order.findOne(query);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order "${orderId}" not found.`,
      });
    }

    // Ownership check: must be owner or admin
    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
      });
    }

    // Idempotent: If already marked paid, return confirmed
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'Paid (Demo)' || order.paymentStatus === 'paid_demo') {
      return res.status(200).json({
        success: true,
        paid: true,
        status: order.paymentStatus,
        isDemo: Boolean(order.isDemoPayment || order.paymentMethod === 'demo_upi_qr'),
        message: 'Payment confirmed successfully!',
        data: { order },
      });
    }

    // If cancelled or failed
    if (order.orderStatus === 'cancelled' || order.paymentStatus === 'failed' || order.paymentStatus === 'failed_demo') {
      return res.status(200).json({
        success: true,
        paid: false,
        status: order.paymentStatus || 'cancelled',
        isDemo: Boolean(order.isDemoPayment || order.paymentMethod === 'demo_upi_qr'),
        message: 'This payment order has been cancelled or failed.',
        data: { order },
      });
    }

    // If demo payment order
    if (order.isDemoPayment || order.paymentMethod === 'demo_upi_qr') {
      return res.status(200).json({
        success: true,
        paid: false,
        status: order.paymentStatus || 'pending',
        isDemo: true,
        message: 'Awaiting demo payment simulation...',
        data: { order },
      });
    }

    // If order has razorpayQrId, query Razorpay live status
    if (order.razorpayQrId && razorpayService.isConfigured()) {
      try {
        const qrDetails = await razorpayService.fetchQrCode(order.razorpayQrId);
        order.razorpayQrStatus = qrDetails.status;

        const amountReceived = qrDetails.payments_amount_received || 0;
        const isPaid = qrDetails.status === 'paid' || (amountReceived > 0 && amountReceived >= order.totalAmountPaise);

        if (isPaid) {
          order.paymentStatus = 'paid';
          order.orderStatus = 'confirmed';
          order.amountPaidPaise = amountReceived;
          await order.save();

          // Atomically deduct inventory
          await deductInventoryForOrder(order);

          // Clear customer's cart
          await Cart.findOneAndUpdate({ userId: order.userId }, { $set: { items: [] } });

          // Send confirmation email
          emailService.sendOrderConfirmation(order).catch(console.error);

          return res.status(200).json({
            success: true,
            paid: true,
            status: 'paid',
            message: 'Payment verified and order confirmed!',
            data: { order },
          });
        } else if (qrDetails.status === 'closed' && amountReceived === 0) {
          order.razorpayQrStatus = 'closed';
          await order.save();
          return res.status(200).json({
            success: true,
            paid: false,
            status: 'closed',
            message: 'QR code has been closed or expired.',
            data: { order },
          });
        }
      } catch (err) {
        console.warn(`[Razorpay QR] Error polling Razorpay QR status for ${order.razorpayQrId}:`, err.message);
      }
    }

    // Expiration check
    if (order.qrExpiresAt && new Date() > new Date(order.qrExpiresAt)) {
      order.razorpayQrStatus = 'expired';
      await order.save();
      return res.status(200).json({
        success: true,
        paid: false,
        status: 'expired',
        message: 'Payment QR code has expired. Please initiate a new order.',
        data: { order },
      });
    }

    return res.status(200).json({
      success: true,
      paid: false,
      status: order.razorpayQrStatus || 'pending',
      message: 'Waiting for payment confirmation...',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/payments/cancel-payment/:orderId
 * Cancels a pending payment and releases the QR code, preserving user's cart
 */
export const cancelQrPayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const query = orderId.startsWith('AUR-') ? { orderNumber: orderId } : { _id: orderId };
    const order = await Order.findOne(query);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order "${orderId}" not found.`,
      });
    }

    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
      });
    }

    if (order.paymentStatus === 'paid' || order.paymentStatus === 'Paid (Demo)' || order.paymentStatus === 'paid_demo') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel an order that has already been paid.',
      });
    }

    // Close Razorpay QR Code if active
    if (order.razorpayQrId && razorpayService.isConfigured()) {
      await razorpayService.closeQrCode(order.razorpayQrId);
      order.razorpayQrStatus = 'closed';
    }

    order.paymentStatus = order.isDemoPayment ? 'failed_demo' : 'failed';
    order.orderStatus = 'cancelled';
    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Payment was cancelled. Your shopping cart has been preserved.',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/payments/demo-simulate-success/:orderId
 * College Demo Simulation: Explicitly marks demo order as Paid (Demo)
 */
export const simulateDemoSuccess = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const query = orderId.startsWith('AUR-') ? { orderNumber: orderId } : { _id: orderId };
    const order = await Order.findOne(query);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Demo order "${orderId}" not found.`,
      });
    }

    // Ownership check: must be owner or admin
    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
      });
    }

    if (!order.isDemoPayment && order.paymentMethod !== 'demo_upi_qr') {
      return res.status(400).json({
        success: false,
        message: 'This order is not a demo payment order.',
      });
    }

    // Idempotent: If already paid, return confirmed
    if (order.paymentStatus === 'Paid (Demo)' || order.paymentStatus === 'paid_demo' || order.paymentStatus === 'paid') {
      return res.status(200).json({
        success: true,
        message: 'Demo order is already marked as Paid (Demo).',
        data: { order },
      });
    }

    // Mark explicitly as Paid (Demo)
    order.paymentStatus = 'Paid (Demo)';
    order.orderStatus = 'confirmed';
    order.amountPaidPaise = order.totalAmountPaise;
    order.demoPaymentNote = 'Simulated Successful Payment for College Demonstration';
    await order.save();

    // Deduct inventory atomically
    await deductInventoryForOrder(order);

    // Clear customer's cart
    await Cart.findOneAndUpdate({ userId: order.userId }, { $set: { items: [] } });

    // Send confirmation email asynchronously
    emailService.sendOrderConfirmation(order).catch(console.error);

    return res.status(200).json({
      success: true,
      message: 'Demo payment simulated successfully! Order confirmed as Paid (Demo).',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/payments/demo-simulate-failure/:orderId
 * College Demo Simulation: Explicitly simulates a failed demo payment, allowing retry
 */
export const simulateDemoFailure = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const query = orderId.startsWith('AUR-') ? { orderNumber: orderId } : { _id: orderId };
    const order = await Order.findOne(query);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Demo order "${orderId}" not found.`,
      });
    }

    // Ownership check: must be owner or admin
    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
      });
    }

    if (order.paymentStatus === 'Paid (Demo)' || order.paymentStatus === 'paid_demo' || order.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot simulate failure on an order that has already been confirmed.',
      });
    }

    order.paymentStatus = 'failed_demo';
    order.demoPaymentNote = 'Simulated Payment Failure for College Demonstration';
    await order.save();

    // Do NOT clear cart; cart remains intact for retry!
    return res.status(200).json({
      success: true,
      message: 'Demo payment simulated as failed. Customer cart preserved for retry.',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/payments/webhook
 * Razorpay Webhook Handler for automated payment reconciliation
 */
export const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    const isValid = razorpayService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.warn('[Razorpay Webhook] Invalid webhook signature rejected.');
      return res.status(400).json({ status: 'invalid_signature' });
    }

    const event = req.body.event;
    console.log(`[Razorpay Webhook] Received verified event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid' || event === 'qr_code.credited') {
      let rzpOrderId = null;
      let rzpPaymentId = null;
      let rzpQrId = null;

      if (event === 'qr_code.credited') {
        const qrEntity = req.body.payload?.qr_code?.entity;
        const paymentEntity = req.body.payload?.payment?.entity;
        rzpQrId = qrEntity?.id;
        rzpPaymentId = paymentEntity?.id;
      } else {
        const paymentEntity = req.body.payload?.payment?.entity;
        rzpOrderId = paymentEntity?.order_id;
        rzpPaymentId = paymentEntity?.id;
      }

      let order = null;
      if (rzpQrId) {
        order = await Order.findOne({ razorpayQrId: rzpQrId });
      } else if (rzpOrderId) {
        order = await Order.findOne({ razorpayOrderId: rzpOrderId });
      }

      if (order && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
        order.orderStatus = 'confirmed';
        if (rzpPaymentId) order.razorpayPaymentId = rzpPaymentId;
        if (rzpQrId) order.razorpayQrStatus = 'paid';
        await order.save();

        await deductInventoryForOrder(order);
        await Cart.findOneAndUpdate({ userId: order.userId }, { $set: { items: [] } });
        emailService.sendOrderConfirmation(order).catch(console.error);
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[Razorpay Webhook] Error processing webhook:', error);
    res.status(500).json({ status: 'error' });
  }
};

/**
 * POST /api/payments/validate-coupon
 * Authoritatively validates coupon code against expiration, min order, and usage limits
 */
export const validateCoupon = async (req, res, next) => {
  try {
    const { couponCode, subtotalINR = 0 } = req.body;
    if (!couponCode || !couponCode.trim()) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'Please provide a coupon code.',
      });
    }

    const cleanCode = couponCode.trim().toUpperCase();
    const subtotal = Number(subtotalINR) || 0;

    let coupon = await Coupon.findOne({ code: cleanCode, isActive: true });

    if (!coupon) {
      // Check fallback promotional codes
      if (['AURA10', 'FIRST20', 'FREESHIP', 'FESTIVE500'].includes(cleanCode)) {
        let discount = 0;
        let desc = '';
        if (cleanCode === 'AURA10') {
          discount = Math.round((subtotal * 10) / 100);
          desc = '10% Off Entire Order';
        } else if (cleanCode === 'FIRST20') {
          discount = Math.round((subtotal * 20) / 100);
          desc = '20% Welcome Offer';
        } else if (cleanCode === 'FREESHIP') {
          discount = 99;
          desc = 'Free Standard Shipping';
        } else if (cleanCode === 'FESTIVE500') {
          if (subtotal < 2499) {
            return res.status(400).json({
              success: false,
              valid: false,
              message: 'Coupon "FESTIVE500" requires a minimum subtotal of ₹2,499.',
            });
          }
          discount = 500;
          desc = 'Flat ₹500 Off (Min ₹2,499)';
        }

        return res.status(200).json({
          success: true,
          valid: true,
          coupon: {
            code: cleanCode,
            description: desc,
            discountINR: discount,
          },
        });
      }

      return res.status(400).json({
        success: false,
        valid: false,
        message: `Invalid coupon code "${cleanCode}". Try AURA10 or FIRST20.`,
      });
    }

    // Expiry check
    if (new Date() > new Date(coupon.expiryDate)) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: `Coupon "${cleanCode}" has expired.`,
      });
    }

    // Min order check
    if (subtotal > 0 && subtotal < coupon.minOrderValueINR) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: `Coupon "${cleanCode}" requires a minimum order value of ₹${coupon.minOrderValueINR}.`,
      });
    }

    // Usage limit check
    if (coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: `Coupon "${cleanCode}" has reached its maximum usage limit.`,
      });
    }

    // Duplicate check for authenticated user
    if (req.user && coupon.usedBy?.some((u) => u.toString() === req.user._id.toString())) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: `You have already redeemed coupon "${cleanCode}".`,
      });
    }

    // Calculate authoritative discount
    let discountINR = 0;
    if (coupon.discountType === 'percentage') {
      const raw = Math.round((subtotal * coupon.discountValue) / 100);
      discountINR = coupon.maxDiscountINR ? Math.min(coupon.maxDiscountINR, raw) : raw;
    } else {
      discountINR = Math.min(subtotal, coupon.discountValue);
    }

    return res.status(200).json({
      success: true,
      valid: true,
      coupon: {
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountINR,
        minOrderValueINR: coupon.minOrderValueINR,
      },
    });
  } catch (error) {
    next(error);
  }
};

