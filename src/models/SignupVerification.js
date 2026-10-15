import mongoose from 'mongoose';

const signupVerificationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    otpHash: {
      type: String,
      default: null,
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    resendAvailableAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    signupTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    signupTokenExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },
    used: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Automatically remove records after 1 hour (3600 seconds)
signupVerificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export const SignupVerification = mongoose.model('SignupVerification', signupVerificationSchema);
export default SignupVerification;
