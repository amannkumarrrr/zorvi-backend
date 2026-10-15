import mongoose from 'mongoose';

const emailDeliverySchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: ['order_confirmation', 'payment_success', 'order_shipped', 'order_cancelled'],
    },
    recipient: {
      type: String,
      required: true,
    },
    resendEmailId: {
      type: String,
      default: '',
    },
    messageId: {
      type: String,
      default: '',
    },
    smtpResponse: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['sent', 'failed', 'skipped'],
      default: 'sent',
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index to prevent duplicate emails for the same event
emailDeliverySchema.index({ orderId: 1, eventType: 1 }, { unique: true });

export const EmailDelivery = mongoose.model('EmailDelivery', emailDeliverySchema);
export default EmailDelivery;
