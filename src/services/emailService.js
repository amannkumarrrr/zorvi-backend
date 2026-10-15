import nodemailer from 'nodemailer';
import EmailDelivery from '../models/EmailDelivery.js';

let transporter = null;

/**
 * Configure and cache Nodemailer transporter for Brevo SMTP
 */
const getTransporter = () => {
  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_KEY;

  if (!user || !pass || user.includes('your_') || pass.includes('your_')) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for port 465, false for 587 (STARTTLS)
      auth: {
        user,
        pass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    console.log(`[Email] Brevo SMTP service initialized (${host}:${port})`);
  }
  return transporter;
};

// Safe string escaping for HTML email injection protection
const escapeHtml = (unsafeStr) => {
  if (!unsafeStr) return '';
  return String(unsafeStr)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Get formatted From header
 */
const getFromAddress = () => {
  const senderName = process.env.BREVO_SENDER_NAME || 'ZORVI';
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_USER || 'noreply@zorvi.com';
  return `"${senderName}" <${senderEmail}>`;
};

export const emailService = {
  /**
   * Check whether Brevo SMTP credentials are configured
   */
  isConfigured() {
    return Boolean(getTransporter());
  },

  /**
   * Verify SMTP connection with Brevo relay
   */
  async verifyConnection() {
    const transport = getTransporter();
    if (!transport) {
      return { success: false, error: 'Brevo SMTP credentials are not configured in environment variables' };
    }
    try {
      await transport.verify();
      console.log('[Email] Brevo SMTP connection verified successfully');
      return { success: true };
    } catch (error) {
      console.error('[Email] Brevo SMTP connection verification failed:', error.message);
      return {
        success: false,
        error: error.message,
        code: error.responseCode || error.code,
      };
    }
  },

  /**
   * Internal sender with idempotency check
   */
  async sendEmailWithIdempotency({ orderId, eventType, recipient, subject, html, text }) {
    // 1. Check if email already sent for this order and eventType
    if (orderId) {
      const existing = await EmailDelivery.findOne({ orderId, eventType });
      if (existing && existing.status === 'sent') {
        console.log(`[Email] Skipped duplicate ${eventType} email for order ${orderId}`);
        return { skipped: true, reason: 'Duplicate' };
      }
    }

    const transport = getTransporter();
    if (!transport) {
      console.warn(`[Email] Brevo SMTP not configured. Skipping ${eventType} email to ${recipient}`);
      if (orderId) {
        await EmailDelivery.findOneAndUpdate(
          { orderId, eventType },
          { recipient, status: 'skipped', error: 'Brevo SMTP credentials missing' },
          { upsert: true, new: true }
        );
      }
      return { skipped: true, reason: 'Missing credentials' };
    }

    const from = getFromAddress();

    try {
      const info = await transport.sendMail({
        from,
        to: recipient,
        subject,
        html,
        text,
      });

      const messageId = info?.messageId;
      const smtpResponse = info?.response;

      if (orderId) {
        await EmailDelivery.findOneAndUpdate(
          { orderId, eventType },
          {
            recipient,
            messageId: messageId || '',
            resendEmailId: messageId || '',
            smtpResponse: smtpResponse || '',
            status: 'sent',
          },
          { upsert: true, new: true }
        );
      }

      console.log(`[Email] Brevo SMTP accepted dispatch to ${recipient}; message ID: ${messageId}`);
      return { success: true, id: messageId };
    } catch (error) {
      const code = error.responseCode || error.code || 'N/A';
      console.error(`[Email] Brevo SMTP rejected sending ${eventType} email to ${recipient}: [${code}] ${error.message}`);

      if (orderId) {
        await EmailDelivery.findOneAndUpdate(
          { orderId, eventType },
          { recipient, status: 'failed', error: error.message },
          { upsert: true, new: true }
        );
      }
      // Never throw error that would cancel order processing
      return { success: false, error: error.message, code };
    }
  },

  /**
   * Send Order Confirmation Email
   */
  async sendOrderConfirmation(order) {
    if (!order || !order.shippingAddress?.email) return;

    const recipient = order.shippingAddress.email;
    const name = escapeHtml(order.shippingAddress.fullName);
    const orderNum = escapeHtml(order.orderNumber);
    const isCod = order.paymentMethod === 'cod';

    const itemsHtml = order.items
      .map(
        (item) => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #1e293b;">
            <strong>${escapeHtml(item.titleSnapshot)}</strong> &times; ${item.quantity}
          </td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-align: right; color: #0f172a; font-weight: bold;">
            ₹${item.lineTotalINR.toLocaleString('en-IN')}
          </td>
        </tr>`
      )
      .join('');

    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: #042f2e; padding: 24px 32px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">ZORVI<span style="color: #2dd4bf;">.</span></h1>
          <p style="color: #99f6e4; margin: 4px 0 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Order Confirmation</p>
        </div>

        <div style="padding: 32px;">
          <p style="font-size: 15px; color: #334155; margin-top: 0;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Thank you for shopping with ZORVI! Your order <strong style="color: #0f172a;">${orderNum}</strong> has been confirmed.
            ${isCod ? 'You have chosen Cash on Delivery (COD). Please have the exact payment ready upon arrival.' : 'Your online payment was verified successfully.'}
          </p>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin: 24px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              ${itemsHtml}
              <tr>
                <td style="padding: 8px 0; font-size: 12px; color: #64748b;">Subtotal</td>
                <td style="padding: 8px 0; font-size: 12px; text-align: right; color: #334155;">₹${order.subtotalINR.toLocaleString('en-IN')}</td>
              </tr>
              ${order.discountINR > 0 ? `
              <tr>
                <td style="padding: 8px 0; font-size: 12px; color: #059669;">Discount</td>
                <td style="padding: 8px 0; font-size: 12px; text-align: right; color: #059669;">-₹${order.discountINR.toLocaleString('en-IN')}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 8px 0; font-size: 12px; color: #64748b;">Shipping Fee</td>
                <td style="padding: 8px 0; font-size: 12px; text-align: right; color: #334155;">${order.shippingFeeINR === 0 ? 'FREE' : `₹${order.shippingFeeINR}`}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0 0 0; font-size: 16px; font-weight: 800; color: #0f172a; border-top: 2px solid #cbd5e1;">Total Amount</td>
                <td style="padding: 12px 0 0 0; font-size: 18px; font-weight: 800; text-align: right; color: #0d9488; border-top: 2px solid #cbd5e1;">₹${order.totalAmountINR.toLocaleString('en-IN')}</td>
              </tr>
            </table>
          </div>

          <h4 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px;">Delivery Address</h4>
          <p style="font-size: 13px; color: #334155; line-height: 1.5; margin: 0 0 24px 0;">
            ${escapeHtml(order.shippingAddress.address)}<br/>
            ${escapeHtml(order.shippingAddress.city)}, ${escapeHtml(order.shippingAddress.state)} — ${escapeHtml(order.shippingAddress.pincode)}<br/>
            Phone: ${escapeHtml(order.shippingAddress.phone)}
          </p>

          <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-bottom: 0;">
            Need help? Contact our support team at <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@zorvi.com'}" style="color: #0d9488; text-decoration: none;">${process.env.SUPPORT_EMAIL || 'support@zorvi.com'}</a>.
          </p>
        </div>
      </div>
    `;

    const text = `Hi ${name},\n\nYour order ${orderNum} has been placed successfully!\nTotal Amount: ₹${order.totalAmountINR}\nPayment Method: ${order.paymentMethod.toUpperCase()}\n\nThank you for shopping with ZORVI!`;

    await this.sendEmailWithIdempotency({
      orderId: order._id,
      eventType: 'order_confirmation',
      recipient,
      subject: `Order Confirmed: #${orderNum} — ZORVI Store`,
      html,
      text,
    });
  },

  /**
   * Send Order Shipped Email
   */
  async sendOrderShipped(order, trackingInfo) {
    if (!order || !order.shippingAddress?.email) return;

    const recipient = order.shippingAddress.email;
    const name = escapeHtml(order.shippingAddress.fullName);
    const orderNum = escapeHtml(order.orderNumber);
    const tracking = escapeHtml(trackingInfo || order.trackingInformation || 'Standard Logistics');

    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: #042f2e; padding: 24px 32px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800;">ZORVI<span style="color: #2dd4bf;">.</span></h1>
          <p style="color: #99f6e4; margin: 4px 0 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase;">Your Order is on the Way!</p>
        </div>

        <div style="padding: 32px;">
          <p style="font-size: 15px; color: #334155; margin-top: 0;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Exciting news! Your order <strong style="color: #0f172a;">${orderNum}</strong> has been shipped and is heading your way.
          </p>

          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0; font-size: 13px; color: #166534;"><strong>Tracking / Dispatch Details:</strong> ${tracking}</p>
          </div>

          <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px;">
            Thank you for choosing ZORVI.
          </p>
        </div>
      </div>
    `;

    const text = `Hi ${name},\n\nYour order ${orderNum} has been shipped!\nTracking details: ${tracking}\n\nThank you for choosing ZORVI!`;

    await this.sendEmailWithIdempotency({
      orderId: order._id,
      eventType: 'order_shipped',
      recipient,
      subject: `Order Shipped: #${orderNum} — ZORVI Store`,
      html,
      text,
    });
  },

  /**
   * Send Password Reset OTP Email
   */
  async sendPasswordResetOtp({ email, name, otp, expiresInMinutes = 5 }) {
    if (!email || !otp) {
      return { success: false, error: 'Recipient email and OTP are required' };
    }

    const safeName = escapeHtml(name || 'Customer');
    const safeOtp = escapeHtml(otp);
    const recipient = email.trim().toLowerCase();
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@zorvi.com';

    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <!-- Header -->
        <div style="background: #042f2e; padding: 28px 32px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">ZORVI<span style="color: #2dd4bf;">.</span></h1>
          <p style="color: #99f6e4; margin: 6px 0 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px;">Password Reset Verification</p>
        </div>

        <!-- Body -->
        <div style="padding: 32px 32px 24px 32px;">
          <p style="font-size: 15px; color: #1e293b; margin-top: 0; font-weight: 600;">Hello ${safeName},</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px 0;">
            We received a request to reset your password for your <strong>ZORVI</strong> account. Use the 6-digit one-time verification code below to authorize this request:
          </p>

          <!-- OTP Display Box -->
          <div style="background: #f0fdfa; border: 2px dashed #0d9488; border-radius: 14px; padding: 22px; text-align: center; margin: 24px 0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #0d9488; letter-spacing: 1px; margin-bottom: 8px;">
              Your 6-Digit Verification Code
            </div>
            <div style="font-size: 34px; font-weight: 800; font-family: 'Courier New', Courier, monospace; letter-spacing: 10px; color: #042f2e;">
              ${safeOtp}
            </div>
            <div style="font-size: 12px; color: #0f766e; margin-top: 8px; font-weight: 500;">
              Expires in ${expiresInMinutes} minutes &bull; Single-use only
            </div>
          </div>

          <!-- Security Notice -->
          <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.5;">
              <strong>Security Notice:</strong> Never share this verification code with anyone. ZORVI staff will never ask for your code or password. If you did not request a password reset, you can safely ignore this email—your account remains secure.
            </p>
          </div>

          <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0 0 16px 0;">
            For immediate support or questions, reach us at <a href="mailto:${supportEmail}" style="color: #0d9488; text-decoration: none; font-weight: 600;">${supportEmail}</a>.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 11px; color: #94a3b8;">
            &copy; ${new Date().getFullYear()} ZORVI Inc. All rights reserved.
          </p>
        </div>
      </div>
    `;

    const text = `Hello ${safeName},\n\nYour 6-digit ZORVI password reset verification code is:\n\n${safeOtp}\n\nThis code expires in ${expiresInMinutes} minutes. Never share this code with anyone.\n\nIf you did not request a password reset, please ignore this email.`;

    const transport = getTransporter();
    if (!transport) {
      console.warn(`[Email] Brevo SMTP not configured. Cannot send password reset OTP to ${recipient}`);
      return { success: false, error: 'Email service credentials not configured' };
    }

    console.log(`[Email] Sending verification email (Password Reset) to ${recipient}`);

    try {
      const info = await transport.sendMail({
        from: getFromAddress(),
        to: recipient,
        subject: `Your ZORVI Password Reset Code: ${safeOtp}`,
        html,
        text,
      });

      const messageId = info?.messageId;
      console.log(`[Email] Brevo SMTP accepted password reset OTP to ${recipient}; message ID: ${messageId}`);
      return { success: true, id: messageId };
    } catch (error) {
      const code = error.responseCode || error.code || 'N/A';
      console.error(`[Email] Brevo SMTP error sending password reset OTP to ${recipient}: [${code}] ${error.message}`);
      return {
        success: false,
        error: error.message,
        code,
      };
    }
  },

  /**
   * Send Signup Verification Email with OTP
   */
  async sendSignupOtp({ email, otp, expiresInMinutes = 5 }) {
    if (!email || !otp) {
      return { success: false, error: 'Recipient email and OTP are required' };
    }

    const safeOtp = escapeHtml(otp);
    const recipient = email.trim().toLowerCase();
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@zorvi.com';

    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <!-- Header -->
        <div style="background: #042f2e; padding: 28px 32px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">ZORVI<span style="color: #2dd4bf;">.</span></h1>
          <p style="color: #99f6e4; margin: 6px 0 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px;">Email Verification Code</p>
        </div>

        <!-- Body -->
        <div style="padding: 32px 32px 24px 32px;">
          <p style="font-size: 15px; color: #1e293b; margin-top: 0; font-weight: 600;">Welcome to ZORVI,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px 0;">
            Thank you for starting your registration with <strong>ZORVI</strong>. Please use the 6-digit verification code below to verify your email address and complete creating your account:
          </p>

          <!-- OTP Display Box -->
          <div style="background: #f0fdfa; border: 2px dashed #0d9488; border-radius: 14px; padding: 22px; text-align: center; margin: 24px 0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #0d9488; letter-spacing: 1px; margin-bottom: 8px;">
              Your 6-Digit Email Verification Code
            </div>
            <div style="font-size: 34px; font-weight: 800; font-family: 'Courier New', Courier, monospace; letter-spacing: 10px; color: #042f2e;">
              ${safeOtp}
            </div>
            <div style="font-size: 12px; color: #0f766e; margin-top: 8px; font-weight: 500;">
              Expires in ${expiresInMinutes} minutes &bull; Single-use only
            </div>
          </div>

          <!-- Security Notice -->
          <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.5;">
              <strong>Security Notice:</strong> Never share this verification code with anyone. ZORVI staff will never ask for your code or password. If you did not request this verification, you can safely ignore this email.
            </p>
          </div>

          <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0 0 16px 0;">
            For immediate support, reach us at <a href="mailto:${supportEmail}" style="color: #0d9488; text-decoration: none; font-weight: 600;">${supportEmail}</a>.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 11px; color: #94a3b8;">
            &copy; ${new Date().getFullYear()} ZORVI Inc. All rights reserved.
          </p>
        </div>
      </div>
    `;

    const text = `Welcome to ZORVI!\n\nYour 6-digit email verification code is: ${safeOtp}\n\nThis code expires in ${expiresInMinutes} minutes. Never share this code with anyone.\n\nIf you did not initiate this signup, please ignore this email.`;

    const transport = getTransporter();
    if (!transport) {
      console.warn(`[Email] Brevo SMTP not configured. Cannot send signup OTP to ${recipient}`);
      return { success: false, error: 'Email service credentials not configured' };
    }

    console.log(`[Email] Sending verification email (Signup OTP) to ${recipient}`);

    try {
      const info = await transport.sendMail({
        from: getFromAddress(),
        to: recipient,
        subject: `Your ZORVI Signup Verification Code: ${safeOtp}`,
        html,
        text,
      });

      const messageId = info?.messageId;
      console.log(`[Email] Brevo SMTP accepted signup OTP to ${recipient}; message ID: ${messageId}`);
      return { success: true, id: messageId };
    } catch (error) {
      const code = error.responseCode || error.code || 'N/A';
      console.error(`[Email] Brevo SMTP error sending signup OTP to ${recipient}: [${code}] ${error.message}`);
      return {
        success: false,
        error: error.message,
        code,
      };
    }
  },

  /**
   * Check delivery status
   */
  async getDeliveryStatus(messageId) {
    if (!messageId) return null;
    return { status: 'accepted', messageId };
  },
};

export default emailService;
