import mongoose from 'mongoose';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';

// Realistic price conversion: 80x multiplier to INR
const toINR = (priceUSD) => Math.round(Number(priceUSD || 0) * 80);

/**
 * Helper to compute cart totals authoritatively from current database records
 */
const recalculateCart = async (cart) => {
  if (!cart || !cart.items || cart.items.length === 0) {
    return {
      items: [],
      totalItems: 0,
      subtotalINR: 0,
      freeDeliveryThreshold: 999,
      deliveryFeeINR: 0,
      estimatedTotalINR: 0,
    };
  }

  // Populate product references
  await cart.populate('items.productId');

  let totalItems = 0;
  let subtotalINR = 0;
  const validItems = [];

  for (const item of cart.items) {
    const product = item.productId;
    // Drop inactive or deleted products automatically
    if (!product || product.isActive === false) {
      continue;
    }

    const availableStock = product.stock || 0;
    // Cap quantity by available stock
    const quantity = Math.min(item.quantity, Math.max(1, availableStock));
    const unitPriceINR = toINR(product.price);
    const lineTotalINR = unitPriceINR * quantity;

    totalItems += quantity;
    subtotalINR += lineTotalINR;

    validItems.push({
      _id: item._id,
      product: {
        _id: product._id,
        id: product._id,
        title: product.title,
        price: product.price,
        discountPercentage: product.discountPercentage || 0,
        thumbnail: product.thumbnail || product.images?.[0] || '',
        category: product.category,
        brand: product.brand,
        stock: product.stock,
      },
      unitPriceINR,
      quantity,
      lineTotalINR,
    });
  }

  // If any invalid items were filtered, save cleaned items back to cart
  if (validItems.length !== cart.items.length) {
    cart.items = validItems.map((v) => ({
      productId: v.product._id,
      quantity: v.quantity,
    }));
    await cart.save();
  }

  const freeDeliveryThreshold = 999;
  const deliveryFeeINR = subtotalINR === 0 ? 0 : subtotalINR >= freeDeliveryThreshold ? 0 : 99;
  const estimatedTotalINR = subtotalINR + deliveryFeeINR;

  return {
    items: validItems,
    totalItems,
    subtotalINR,
    freeDeliveryThreshold,
    deliveryFeeINR,
    estimatedTotalINR,
  };
};

/**
 * GET /api/cart
 */
export const getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      cart = await Cart.create({ userId: req.user._id, items: [] });
    }

    const cartData = await recalculateCart(cart);

    res.status(200).json({
      success: true,
      message: 'Cart retrieved successfully',
      data: cartData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/cart/items
 */
export const addItemToCart = async (req, res, next) => {
  try {
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'productId is required',
        errors: [{ field: 'productId', message: 'Product ID is missing.' }],
      });
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 1) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be at least 1.',
        errors: [{ field: 'quantity', message: 'Invalid quantity.' }],
      });
    }

    // Verify product exists and has stock (supports 24-char ObjectId or numeric DummyJSON externalId)
    let product = null;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(productId));
    if (isObjectId) {
      product = await Product.findOne({ _id: productId, isActive: true });
    }
    if (!product && !isNaN(productId)) {
      product = await Product.findOne({ externalId: Number(productId), isActive: true });
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or unavailable.',
        errors: [],
      });
    }

    let cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      cart = new Cart({ userId: req.user._id, items: [] });
    }

    const resolvedId = product._id.toString();
    const existingIndex = cart.items.findIndex(
      (item) => item.productId.toString() === resolvedId
    );

    if (existingIndex > -1) {
      const newQuantity = cart.items[existingIndex].quantity + qty;
      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Cannot add more. Available stock limit is ${product.stock}.`,
          errors: [{ field: 'quantity', message: 'Insufficient inventory.' }],
        });
      }
      cart.items[existingIndex].quantity = newQuantity;
    } else {
      if (qty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Cannot add ${qty} units. Only ${product.stock} available.`,
          errors: [{ field: 'quantity', message: 'Insufficient inventory.' }],
        });
      }
      cart.items.push({ productId: product._id, quantity: qty });
    }

    await cart.save();
    const cartData = await recalculateCart(cart);

    res.status(200).json({
      success: true,
      message: `Added "${product.title}" to cart`,
      data: cartData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/cart/items/:productId
 */
export const updateCartItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    const qty = parseInt(quantity, 10);
    if (isNaN(qty)) {
      return res.status(400).json({
        success: false,
        message: 'Valid integer quantity is required.',
        errors: [],
      });
    }

    let cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found.',
        errors: [],
      });
    }

    let resolvedId = productId;
    let product = null;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(productId));
    if (isObjectId) {
      product = await Product.findOne({ _id: productId, isActive: true });
      if (product) resolvedId = product._id.toString();
    }
    if (!product && !isNaN(productId)) {
      product = await Product.findOne({ externalId: Number(productId), isActive: true });
      if (product) resolvedId = product._id.toString();
    }

    // If quantity is 0 or less, remove item
    if (qty <= 0) {
      cart.items = cart.items.filter(
        (item) => item.productId.toString() !== resolvedId
      );
    } else {
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product unavailable.',
          errors: [],
        });
      }

      if (qty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units in stock.`,
          errors: [],
        });
      }

      const item = cart.items.find(
        (i) => i.productId.toString() === resolvedId
      );
      if (item) {
        item.quantity = qty;
      } else {
        cart.items.push({ productId: product._id, quantity: qty });
      }
    }

    await cart.save();
    const cartData = await recalculateCart(cart);

    res.status(200).json({
      success: true,
      message: 'Cart updated',
      data: cartData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/cart/items/:productId
 */
export const removeCartItem = async (req, res, next) => {
  try {
    const { productId } = req.params;

    let resolvedId = productId;
    if (!/^[0-9a-fA-F]{24}$/.test(String(productId)) && !isNaN(productId)) {
      const p = await Product.findOne({ externalId: Number(productId) });
      if (p) resolvedId = p._id.toString();
    }

    const cart = await Cart.findOne({ userId: req.user._id });
    if (cart) {
      cart.items = cart.items.filter(
        (item) => item.productId.toString() !== resolvedId
      );
      await cart.save();
    }

    const cartData = await recalculateCart(cart);

    res.status(200).json({
      success: true,
      message: 'Item removed from cart',
      data: cartData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/cart
 */
export const clearCart = async (req, res, next) => {
  try {
    await Cart.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { items: [] } },
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Cart cleared successfully',
      data: {
        items: [],
        totalItems: 0,
        subtotalINR: 0,
        deliveryFeeINR: 0,
        estimatedTotalINR: 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/cart/merge
 * Merges guest cart items into authenticated user cart
 */
export const mergeGuestCart = async (req, res, next) => {
  try {
    const { items = [] } = req.body;

    let cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      cart = new Cart({ userId: req.user._id, items: [] });
    }

    for (const guestItem of items) {
      const pid = guestItem.id || guestItem.productId;
      if (!pid) continue;

      const product = await Product.findOne({
        $or: [{ _id: pid }, { externalId: Number(pid) }],
        isActive: true,
      });

      if (!product) continue;

      const existingIndex = cart.items.findIndex(
        (i) => i.productId.toString() === product._id.toString()
      );

      const qty = Math.max(1, parseInt(guestItem.quantity || 1, 10));

      if (existingIndex > -1) {
        cart.items[existingIndex].quantity = Math.min(
          cart.items[existingIndex].quantity + qty,
          product.stock || 50
        );
      } else {
        cart.items.push({
          productId: product._id,
          quantity: Math.min(qty, product.stock || 50),
        });
      }
    }

    await cart.save();
    const cartData = await recalculateCart(cart);

    res.status(200).json({
      success: true,
      message: 'Guest cart merged successfully',
      data: cartData,
    });
  } catch (error) {
    next(error);
  }
};
