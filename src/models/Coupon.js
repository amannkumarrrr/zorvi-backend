import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Coupon code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
      default: 'percentage',
    },
    discountValue: {
      type: Number,
      required: true,
      min: [1, 'Discount value must be at least 1'],
    },
    minOrderValueINR: {
      type: Number,
      default: 0,
      min: [0, 'Minimum order value cannot be negative'],
    },
    maxDiscountINR: {
      type: Number,
      default: null, // Optional cap for percentage discounts
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    usageLimit: {
      type: Number,
      default: 500,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    usedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Helper to seed initial default coupons idempotently
couponSchema.statics.seedDefaultCoupons = async function () {
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + 2); // 2 years in future

  const defaultCoupons = [
    {
      code: 'ZORVI10',
      description: '10% Off on orders above ₹499 (up to ₹1,000 off)',
      discountType: 'percentage',
      discountValue: 10,
      minOrderValueINR: 499,
      maxDiscountINR: 1000,
      expiryDate: futureDate,
      usageLimit: 1000,
    },
    {
      code: 'AURA10',
      description: '10% Off on orders above ₹499 (up to ₹1,000 off)',
      discountType: 'percentage',
      discountValue: 10,
      minOrderValueINR: 499,
      maxDiscountINR: 1000,
      expiryDate: futureDate,
      usageLimit: 1000,
    },
    {
      code: 'FIRST20',
      description: '20% Welcome Discount for new orders above ₹999 (up to ₹2,000 off)',
      discountType: 'percentage',
      discountValue: 20,
      minOrderValueINR: 999,
      maxDiscountINR: 2000,
      expiryDate: futureDate,
      usageLimit: 500,
    },
    {
      code: 'FREESHIP',
      description: 'Free Shipping discount on all orders above ₹299',
      discountType: 'fixed',
      discountValue: 99,
      minOrderValueINR: 299,
      expiryDate: futureDate,
      usageLimit: 2000,
    },
    {
      code: 'FESTIVE500',
      description: 'Flat ₹500 Off on orders above ₹2,499',
      discountType: 'fixed',
      discountValue: 500,
      minOrderValueINR: 2499,
      expiryDate: futureDate,
      usageLimit: 500,
    },
  ];

  const operations = defaultCoupons.map((coupon) => ({
    updateOne: {
      filter: { code: coupon.code },
      update: { $setOnInsert: coupon },
      upsert: true,
    },
  }));

  await this.bulkWrite(operations, { ordered: false });
  console.log('[Coupon] Verified and initialized default promotional coupons.');
};

export const Coupon = mongoose.model('Coupon', couponSchema);
export default Coupon;
