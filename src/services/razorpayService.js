import Razorpay from 'razorpay';
import crypto from 'crypto';
import QRCode from 'qrcode';

let razorpayInstance = null;

const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret || key_id.includes('your_razorpay')) {
    return null;
  }

  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id,
      key_secret,
    });
  }

  return razorpayInstance;
};

export const razorpayService = {
  /**
   * Check if Razorpay is configured
   */
  isConfigured() {
    return Boolean(getRazorpayInstance());
  },

  /**
   * Create Razorpay Order
   * @param {Object} options { amount (paise), currency: 'INR', receipt, notes }
   */
  async createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
    const rzp = getRazorpayInstance();
    if (!rzp) {
      throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.');
    }

    try {
      const order = await rzp.orders.create({
        amount: Math.round(amount), // Amount in paise
        currency,
        receipt,
        notes,
      });
      return order;
    } catch (error) {
      console.error('[Razorpay] Order creation failed:', error);
      throw new Error(error.description || error.message || 'Failed to initialize payment with Razorpay');
    }
  },

  /**
   * Verify Razorpay Payment Signature
   * sha256(order_id + "|" + payment_id, secret) == signature
   */
  verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new Error('RAZORPAY_KEY_SECRET is not configured on the backend.');
    }

    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const generatedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return generatedSignature === razorpaySignature;
  },

  /**
   * Verify Razorpay Webhook Signature
   */
  verifyWebhookSignature(rawBody, signature) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret || !signature) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    return expectedSignature === signature;
  },

  /**
   * Create a dynamic, single-use Razorpay UPI QR Code
   * @param {Object} options { amount (paise), orderNumber, notes, closeBySeconds }
   */
  async createQrCode({ amount, orderNumber, notes = {}, closeBySeconds = 900 }) {
    const rzp = getRazorpayInstance();
    if (!rzp) {
      const err = new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.');
      err.isConfigurationError = true;
      throw err;
    }

    try {
      const close_by = Math.floor(Date.now() / 1000) + closeBySeconds;
      const qrResponse = await rzp.qrCode.create({
        type: 'upi_qr',
        name: 'AURA Commerce',
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: Math.round(amount), // in paise
        description: `Order ${orderNumber}`,
        close_by,
        notes: {
          ...notes,
          orderNumber,
        },
      });

      return qrResponse;
    } catch (error) {
      console.error('[Razorpay] QR code creation failed:', error);
      const statusCode = error.statusCode || error.status || 500;
      const errDescription = error.error?.description || error.description || error.message || '';
      const isFeatureUnavailable =
        statusCode === 400 ||
        statusCode === 404 ||
        error.error?.code === 'BAD_REQUEST_ERROR' ||
        errDescription.toLowerCase().includes('not found') ||
        errDescription.toLowerCase().includes('not enabled') ||
        errDescription.toLowerCase().includes('smart collect');

      const enhancedErr = new Error(
        isFeatureUnavailable
          ? 'Razorpay Dynamic UPI QR payments are not activated on this merchant account. Please activate the QR Code / Smart Collect feature in your Razorpay Dashboard, or select Online Payment / Cash on Delivery.'
          : (errDescription || 'Failed to generate dynamic UPI QR code with Razorpay.')
      );
      enhancedErr.statusCode = statusCode;
      enhancedErr.isQrNotActivated = isFeatureUnavailable;
      enhancedErr.rawError = error;
      throw enhancedErr;
    }
  },

  /**
   * Fetch QR code status and details from Razorpay
   */
  async fetchQrCode(qrId) {
    const rzp = getRazorpayInstance();
    if (!rzp) {
      throw new Error('Razorpay credentials not configured.');
    }
    try {
      return await rzp.qrCode.fetch(qrId);
    } catch (error) {
      console.error(`[Razorpay] Fetch QR code failed for ${qrId}:`, error);
      throw error;
    }
  },

  /**
   * Fetch all payments received against a QR code
   */
  async fetchAllQrPayments(qrId) {
    const rzp = getRazorpayInstance();
    if (!rzp) {
      throw new Error('Razorpay credentials not configured.');
    }
    try {
      return await rzp.qrCode.fetchAllPayments(qrId);
    } catch (error) {
      console.error(`[Razorpay] Fetch QR payments failed for ${qrId}:`, error);
      throw error;
    }
  },

  /**
   * Close an active Razorpay QR Code
   */
  async closeQrCode(qrId) {
    const rzp = getRazorpayInstance();
    if (!rzp) {
      throw new Error('Razorpay credentials not configured.');
    }
    try {
      return await rzp.qrCode.close(qrId);
    } catch (error) {
      console.warn(`[Razorpay] Warning: Closing QR code ${qrId} failed:`, error?.message || error);
      return null;
    }
  },

  /**
   * Generate base64 Data URL for QR string/payload
   */
  async generateQrDataUrl(text) {
    if (!text) return null;
    try {
      return await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
    } catch (err) {
      console.error('[QRCode] Failed to generate data URL:', err);
      return null;
    }
  },
};

export default razorpayService;

