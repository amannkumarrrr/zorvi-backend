import { z } from 'zod';

export const signupOtpSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Please provide a valid email address format'),
  }),
});

export const verifySignupOtpSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Please provide a valid email address format'),
    otp: z.string().trim().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits'),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name cannot exceed 80 characters'),
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
    password: z.string().min(6, 'Password must be at least 6 characters').max(100, 'Password cannot exceed 100 characters'),
    signupToken: z.string().trim().min(10, 'Email verification token is required to complete registration'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().min(1, 'Email address or username is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
    phone: z.string().trim().max(20).optional(),
  }),
});

export const createProductSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2, 'Product title is required').max(200),
    description: z.string().trim().min(5, 'Product description is required'),
    category: z.string().trim().min(1, 'Category is required'),
    brand: z.string().trim().optional(),
    price: z.coerce.number().min(0, 'Price cannot be negative'),
    discountPercentage: z.coerce.number().min(0).max(100).optional().default(0),
    thumbnail: z.string().trim().min(1, 'Thumbnail image URL is required'),
    images: z.array(z.string()).optional().default([]),
    rating: z.coerce.number().min(0).max(5).optional().default(4.5),
    stock: z.coerce.number().int().min(0, 'Stock cannot be negative').default(50),
    sku: z.string().trim().optional(),
    warrantyInformation: z.string().trim().optional(),
    shippingInformation: z.string().trim().optional(),
    availabilityStatus: z.string().trim().optional(),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Product ID parameter is required'),
  }),
  body: z.object({
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().min(5).optional(),
    category: z.string().trim().optional(),
    brand: z.string().trim().optional(),
    price: z.coerce.number().min(0).optional(),
    discountPercentage: z.coerce.number().min(0).max(100).optional(),
    thumbnail: z.string().trim().optional(),
    images: z.array(z.string()).optional(),
    rating: z.coerce.number().min(0).max(5).optional(),
    stock: z.coerce.number().int().min(0).optional(),
    sku: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    warrantyInformation: z.string().trim().optional(),
    shippingInformation: z.string().trim().optional(),
    availabilityStatus: z.string().trim().optional(),
  }),
});

export const queryProductsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(12),
    q: z.string().trim().optional(),
    category: z.string().trim().optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sortBy: z.enum(['default', 'price-asc', 'price-desc', 'rating-desc', 'title-asc', 'newest']).optional().default('default'),
  }),
});

export const categorySlugSchema = z.object({
  params: z.object({
    slug: z.string().trim().min(1, 'Category slug is required'),
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(12),
  }),
});

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Category name is required').max(80),
    slug: z.string().trim().min(2, 'Category slug is required').toLowerCase(),
    description: z.string().trim().optional(),
    image: z.string().trim().optional(),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Please provide a valid registered email address'),
  }),
});

export const verifyResetOtpSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Please provide a valid email address'),
    otp: z.string().trim().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Please provide a valid email address'),
    resetToken: z.string().trim().min(10, 'Invalid or missing reset token'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters').max(100, 'Password cannot exceed 100 characters'),
  }),
});

