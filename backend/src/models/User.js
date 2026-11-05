import mongoose from 'mongoose';

const youtubeSchema = new mongoose.Schema(
  {
    channelId: { type: String, default: null },
    channelTitle: { type: String, default: null },
    accessToken: { type: String, default: null, select: false },
    refreshToken: { type: String, default: null, select: false },
    tokenExpiresAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    status: { type: String, enum: ['inactive', 'active', 'past_due', 'canceled', 'trialing'], default: 'inactive' },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    lastPaymentAt: { type: Date, default: null },
  },
  { _id: false }
);

const preferencesSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: 'UTC' },
    defaultLanguage: { type: String, default: 'en' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    avatarUrl: { type: String, default: null },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    youtube: { type: youtubeSchema, default: () => ({}) },
    // App-level session refresh token (separate from YouTube OAuth).
    sessionRefreshToken: { type: String, default: null, select: false },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    subscription: { type: subscriptionSchema, default: () => ({ plan: 'free', status: 'inactive' }) },
    preferences: { type: preferencesSchema, default: () => ({ timezone: 'UTC', defaultLanguage: 'en' }) },
  },
  {
    timestamps: true,
  }
);

// Never leak password in JSON responses.
userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.sessionRefreshToken;
  if (obj.youtube) {
    delete obj.youtube.accessToken;
    delete obj.youtube.refreshToken;
  }
  return obj;
};

const User = mongoose.model('User', userSchema);
export default User;
