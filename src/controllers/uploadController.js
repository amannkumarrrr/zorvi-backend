import cloudinaryService from '../services/cloudinaryService.js';

/**
 * POST /api/admin/uploads/image
 * Uploads a single image buffer to Cloudinary
 */
export const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded. Please select an image (JPEG, PNG, or WebP up to 5MB).',
        errors: [{ field: 'image', message: 'Image file is required.' }],
      });
    }

    const folder = req.body.folder || 'aura_products';
    const uploadResult = await cloudinaryService.uploadImageBuffer(req.file.buffer, folder);

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully to Cloudinary',
      data: uploadResult,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/uploads/images
 * Uploads multiple image buffers to Cloudinary
 */
export const uploadMultiple = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No image files uploaded.',
        errors: [{ field: 'images', message: 'At least one image is required.' }],
      });
    }

    const folder = req.body.folder || 'aura_products';
    const uploadPromises = req.files.map((file) =>
      cloudinaryService.uploadImageBuffer(file.buffer, folder)
    );

    const results = await Promise.all(uploadPromises);

    res.status(200).json({
      success: true,
      message: `${results.length} images uploaded successfully to Cloudinary`,
      data: {
        images: results,
      },
    });
  } catch (error) {
    next(error);
  }
};
