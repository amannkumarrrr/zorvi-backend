import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Category from '../models/Category.js';

const DUMMY_PRODUCTS_URL = 'https://dummyjson.com/products?limit=0';
const DUMMY_CATEGORIES_URL = 'https://dummyjson.com/products/categories';

const importCatalog = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI is required to run the import script.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[Import] Connected to MongoDB Atlas.');

    // 1. Fetch & import categories
    console.log('[Import] Fetching categories from DummyJSON...');
    const catRes = await fetch(DUMMY_CATEGORIES_URL);
    const rawCategories = await catRes.json();

    let importedCategories = 0;
    for (const cat of rawCategories) {
      const slug = typeof cat === 'string' ? cat.toLowerCase() : (cat.slug || cat.name).toLowerCase();
      const name = typeof cat === 'string'
        ? cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : (cat.name || cat.slug);

      const exists = await Category.findOne({ slug });
      if (!exists) {
        await Category.create({
          name,
          slug,
          description: `Curated ${name} collection`,
          isActive: true,
        });
        importedCategories++;
      }
    }
    console.log(`[Import] Categories processed. Added ${importedCategories} new categories.`);

    // 2. Fetch & import products
    console.log('[Import] Fetching all products from DummyJSON (limit=0)...');
    const prodRes = await fetch(DUMMY_PRODUCTS_URL);
    const prodData = await prodRes.json();
    const products = prodData.products || [];

    let importedCount = 0;
    let skippedCount = 0;

    for (const item of products) {
      const externalId = item.id;
      const categorySlug = (item.category || 'general').toLowerCase();

      // Check for existing product by externalId or SKU
      const existing = await Product.findOne({
        $or: [{ externalId }, { sku: item.sku || `DUMMY-${externalId}` }],
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      await Product.create({
        title: item.title,
        description: item.description,
        category: categorySlug,
        brand: item.brand || 'AURA Signature',
        price: item.price,
        discountPercentage: item.discountPercentage || 0,
        thumbnail: item.thumbnail || item.images?.[0] || '',
        images: item.images || [],
        rating: item.rating || 4.5,
        stock: item.stock || 50,
        sku: item.sku || `DUMMY-${externalId}`,
        externalId,
        isDemoCatalog: true, // Clearly marks imported records as demo catalog
        warrantyInformation: item.warrantyInformation || '1 Year Brand Warranty',
        shippingInformation: item.shippingInformation || 'Standard 2-4 Days Shipping',
        availabilityStatus: item.availabilityStatus || 'In Stock',
        reviews: (item.reviews || []).map(r => ({
          rating: r.rating || 5,
          comment: r.comment || 'Great quality!',
          date: r.date || new Date(),
          reviewerName: r.reviewerName || 'Customer',
          reviewerEmail: r.reviewerEmail,
        })),
        isActive: true,
      });

      importedCount++;
    }

    console.log(`[Import] Completed: ${importedCount} products imported, ${skippedCount} existing products preserved.`);

    await mongoose.connection.close();
    console.log('[Import] Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('[Import] Error importing demo data:', error.message);
    process.exit(1);
  }
};

importCatalog();
