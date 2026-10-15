import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary from environment variables
const configureCloudinary = () => {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;

  if (cloud_name && api_key && api_secret && !cloud_name.includes('your_cloudinary')) {
    cloudinary.config({
      cloud_name,
      api_key,
      api_secret,
      secure: true,
    });
    return true;
  }
  return false;
};

export const cloudinaryService = {
  isConfigured() {
    return configureCloudinary();
  },

  /**
   * Upload an image buffer directly to Cloudinary
   * @param {Buffer} buffer - image buffer from multer
   * @param {String} folder - destination folder in Cloudinary
   */
  async uploadImageBuffer(buffer, folder = 'aura_products') {
    if (!this.isConfigured()) {
      throw new Error('Cloudinary is not fully configured. Please ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set in backend/.env.');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result) => {
          if (error) {
            console.error('[Cloudinary] Upload error:', error.message);
            return reject(new Error(error.message || 'Image upload to Cloudinary failed.'));
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height,
          });
        }
      );

      uploadStream.end(buffer);
    });
  },
};

export default cloudinaryService;
