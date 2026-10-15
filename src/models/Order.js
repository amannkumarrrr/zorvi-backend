import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    titleSnapshot: {
      type: String,
      required: true,
    },
    imageSnapshot: {
      type: String,
      default: '',
    },
    unitPrice: {
      type: Number,
      required: true,
    },
    unitPriceINR: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    lineTotalINR: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, default: 'India' },
    deliveryNotes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: [orderItemSchema],
    shippingAddress: shippingAddressSchema,
    subtotalINR: {
      type: Number,
      required: true,
      min: 0,
    },
    discountINR: {
      type: Number,
      default: 0,
      min: 0,
    },
    couponCode: {
      type: String,
      default: null,
    },
    shippingFeeINR: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmountINR: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    paymentMethod: {
      type: String,
      enum: ['cod', 'razorpay', 'upi_qr', 'demo_upi_qr'],
      required: true,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'paid_demo', 'failed_demo', 'Paid (Demo)'],
      default: 'pending',
      index: true,
    },
    orderStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    // Demo Payment Fields (for college demonstration)
    isDemoPayment: {
      type: Boolean,
      default: false,
      index: true,
    },
    demoPaymentRef: {
      type: String,
      default: null,
    },
    demoQrDataUrl: {
      type: String,
      default: null,
    },
    demoPayload: {
      type: String,
      default: null,
    },
    demoPaymentNote: {
      type: String,
      default: null,
    },
    razorpayOrderId: {
      type: String,
      sparse: true,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      sparse: true,
      index: true,
    },
    razorpaySignature: {
      type: String,
      default: null,
    },
    razorpayQrId: {
      type: String,
      sparse: true,
      index: true,
    },
    razorpayQrImageUrl: {
      type: String,
      default: null,
    },
    razorpayQrString: {
      type: String,
      default: null,
    },
    razorpayQrStatus: {
      type: String,
      enum: ['active', 'closed', 'paid', 'expired', null],
      default: null,
    },
    qrExpiresAt: {
      type: Date,
      default: null,
    },
    amountPaidPaise: {
      type: Number,
      default: 0,
    },
    inventoryDeducted: {
      type: Boolean,
      default: false,
      index: true,
    },
    trackingInformation: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for order lookups
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
export default Order;
