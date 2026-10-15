import mongoose from 'mongoose';

const reviewSubSchema = new mongoose.Schema(
  {
    rating: { type: Number, min: 1, max: 5, default: 5 },
    comment: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    reviewerName: { type: String, trim: true, default: 'Customer' },
    reviewerEmail: { type: String, trim: true },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Product title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    brand: {
      type: String,
      trim: true,
      default: 'AURA',
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
      index: true,
    },
    discountPercentage: {
      type: Number,
      min: [0, 'Discount cannot be negative'],
      max: [100, 'Discount cannot exceed 100%'],
      default: 0,
    },
    thumbnail: {
      type: String,
      required: [true, 'Thumbnail image URL is required'],
    },
    images: {
      type: [String],
      default: [],
    },
    rating: {
      type: Number,
      min: [0, 'Rating cannot be negative'],
      max: [5, 'Rating cannot exceed 5'],
      default: 4.5,
      index: true,
    },
    stock: {
      type: Number,
      required: [true, 'Stock count is required'],
      min: [0, 'Stock cannot be negative'],
      default: 50,
    },
    sku: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    externalId: {
      type: Number,
      sparse: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['dummyjson', 'admin', 'local'],
      default: 'dummyjson',
      index: true,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    currencySymbol: {
      type: String,
      default: '$',
    },
    isDemoCatalog: {
      type: Boolean,
      default: false,
    },
    warrantyInformation: {
      type: String,
      default: '1 Year Brand Warranty',
    },
    shippingInformation: {
      type: String,
      default: 'Ships within 24 hours',
    },
    availabilityStatus: {
      type: String,
      default: 'In Stock',
    },
    reviews: [reviewSubSchema],
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

// Full-text search index on title, description, and brand
productSchema.index(
  { title: 'text', description: 'text', brand: 'text' },
  { weights: { title: 10, brand: 5, description: 1 }, name: 'ProductTextIndex' }
);

// Compound indexes for sorting and filtering
productSchema.index({ isActive: 1, category: 1, price: 1 });
productSchema.index({ isActive: 1, rating: -1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ externalId: 1, source: 1 });

export const Product = mongoose.model('Product', productSchema);
export default Product;
