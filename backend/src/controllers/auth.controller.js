import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken, refreshCookieOptions } from '../utils/token.js';
import {
  buildYouTubeAuthUrl,
  generateState,
  exchangeCodeForTokens,
  fetchYouTubeChannels,
  refreshYouTubeAccessToken,
} from '../services/youtubeOauth.service.js';
import { env } from '../config/env.js';

const YOUTUBE_STATE_COOKIE = 'yt_oauth_state';
const stateCookieOptions = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'lax',
  maxAge: 10 * 60 * 1000, // 10 minutes
  path: '/',
};

// ---------- Register ----------
export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    const err = new Error('Name, email and password are required');
    err.statusCode = 400;
    throw err;
  }
  if (String(password).length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.statusCode = 400;
    throw err;
  }

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    throw err;
  }

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);

  const user = await User.create({
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    password: hashed,
  });

  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  user.sessionRefreshToken = hashRefreshToken(refreshToken);
  await user.save();

  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: { user, accessToken },
  });
});

// ---------- Login ----------
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.statusCode = 400;
    throw err;
  }

  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password +sessionRefreshToken');
  if (!user) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  if (!user.isActive) {
    const err = new Error('Account is deactivated');
    err.statusCode = 403;
    throw err;
  }

  user.lastLoginAt = new Date();
  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  user.sessionRefreshToken = hashRefreshToken(refreshToken);
  await user.save();

  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: { user, accessToken },
  });
});

// ---------- Logout ----------
export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    const hashed = hashRefreshToken(token);
    await User.updateOne({ sessionRefreshToken: hashed }, { $set: { sessionRefreshToken: null } });
  }
  res.clearCookie('refreshToken', refreshCookieOptions);
  res.clearCookie('accessToken', { path: '/' });
  res.status(200).json({ success: true, message: 'Logged out' });
});

// ---------- Me ----------
export const me = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: { user: req.user } });
});

// ---------- Refresh access token ----------
export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) {
    const err = new Error('No refresh token');
    err.statusCode = 401;
    throw err;
  }
  const hashed = hashRefreshToken(token);
  const user = await User.findOne({ sessionRefreshToken: hashed }).select('+sessionRefreshToken');
  if (!user) {
    const err = new Error('Invalid refresh token');
    err.statusCode = 401;
    throw err;
  }

  const accessToken = signAccessToken(user);
  // rotate refresh token
  const newRefresh = generateRefreshToken();
  user.sessionRefreshToken = hashRefreshToken(newRefresh);
  await user.save();

  res.cookie('refreshToken', newRefresh, refreshCookieOptions);
  res.status(200).json({ success: true, data: { accessToken } });
});

// ---------- YouTube OAuth: connect ----------
export const youtubeConnect = asyncHandler(async (req, res) => {
  if (!env.youtubeClientId || !env.youtubeClientSecret) {
    const err = new Error('YouTube OAuth not configured on server');
    err.statusCode = 500;
    throw err;
  }
  const state = generateState();
  res.cookie(YOUTUBE_STATE_COOKIE, state, stateCookieOptions);
  const url = buildYouTubeAuthUrl(state);
  res.status(200).json({ success: true, data: { url } });
});

// ---------- YouTube OAuth: callback ----------
export const youtubeCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const savedState = req.cookies?.[YOUTUBE_STATE_COOKIE];

  if (error) {
    res.clearCookie(YOUTUBE_STATE_COOKIE, { path: '/' });
    return res.redirect(`${env.clientUrl}/settings?youtube=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !savedState || state !== savedState) {
    res.clearCookie(YOUTUBE_STATE_COOKIE, { path: '/' });
    return res.redirect(`${env.clientUrl}/settings?youtube=error&reason=invalid_state`);
  }

  // Need authenticated user. We support passing userId via state? Simpler: require login first; here we can't know user from callback without session.
  // Strategy: state stores userId signed? We'll look up via a short-lived signed cookie set at connect time.
  // For now, expect `req.user` is not available in redirect. Use a cookie 'yt_oauth_user' set during connect (httpOnly).
  const userId = req.cookies?.yt_oauth_user;
  if (!userId) {
    res.clearCookie(YOUTUBE_STATE_COOKIE, { path: '/' });
    return res.redirect(`${env.clientUrl}/login?next=youtube`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const channels = await fetchYouTubeChannels(tokens.access_token);

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const selected = channels[0];
    const connection = {
      channelId: selected.channelId,
      channelTitle: selected.channelTitle,
      channels,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || user.youtube?.refreshToken || null,
      tokenExpiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
      connectedAt: new Date(),
    };

    user.youtubeAccounts = user.youtubeAccounts || [];
    const existingIndex = user.youtubeAccounts.findIndex(
      (account) => account.channelId === connection.channelId,
    );
    if (existingIndex >= 0) {
      user.youtubeAccounts[existingIndex] = connection;
    } else {
      user.youtubeAccounts.push(connection);
    }
    user.youtube = connection;
    await user.save();

    res.clearCookie(YOUTUBE_STATE_COOKIE, { path: '/' });
    res.clearCookie('yt_oauth_user', { path: '/' });
    return res.redirect(`${env.clientUrl}/settings?youtube=connected`);
  } catch (e) {
    res.clearCookie(YOUTUBE_STATE_COOKIE, { path: '/' });
    return res.redirect(`${env.clientUrl}/settings?youtube=error&reason=${encodeURIComponent(e.message)}`);
  }
});

// ---------- YouTube OAuth: status ----------
export const youtubeStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken');
  const yt = user.youtube || {};

  user.youtubeAccounts = user.youtubeAccounts || [];
  // Backfill for older connections without accounts array.
  if (user.youtubeAccounts.length === 0 && yt.channelId) {
    user.youtubeAccounts = [
      {
        channelId: yt.channelId,
        channelTitle: yt.channelTitle,
        channels: yt.channels || [{ channelId: yt.channelId, channelTitle: yt.channelTitle }],
        accessToken: yt.accessToken,
        refreshToken: yt.refreshToken,
        tokenExpiresAt: yt.tokenExpiresAt,
        connectedAt: yt.connectedAt,
      },
    ];
    await user.save();
  }

  // Backfill channel list for the active connection if needed.
  if (yt.accessToken && !(yt.channels && yt.channels.length) && user.youtubeAccounts.length === 0) {
    try {
      const { fetchYouTubeChannels } = await import('../services/youtubeOauth.service.js');
      const channels = await fetchYouTubeChannels(yt.accessToken);
      yt.channels = channels;
      if (!yt.channelId && channels.length) {
        yt.channelId = channels[0].channelId;
        yt.channelTitle = channels[0].channelTitle;
      }
      user.youtube = yt;
      await user.save();
    } catch {
      // ignore live fetch failures
    }
  }

  const accounts = (user.youtubeAccounts || []).map((account) => ({
    channelId: account.channelId,
    channelTitle: account.channelTitle,
    connectedAt: account.connectedAt,
  }));

  res.status(200).json({
    success: true,
    data: {
      connected: Boolean(yt.channelId),
      channelId: yt.channelId || null,
      channelTitle: yt.channelTitle || null,
      channels: yt.channels || [],
      accounts,
      connectedAt: yt.connectedAt || null,
      tokenExpiresAt: yt.tokenExpiresAt || null,
    },
  });
});

export const youtubeSelectChannel = asyncHandler(async (req, res) => {
  const channelId = String(req.body?.channelId || '').trim();
  if (!channelId) {
    const err = new Error('channelId is required');
    err.statusCode = 400;
    throw err;
  }
  const user = await User.findById(req.user._id).select('+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken');
  const yt = user.youtube || {};

  // If selecting among channels of the active account:
  const channels = yt.channels || [];
  const channel = channels.find((item) => item.channelId === channelId);
  if (channel) {
    yt.channelId = channel.channelId;
    yt.channelTitle = channel.channelTitle;
    user.youtube = yt;
    await user.save();
    return res.status(200).json({
      success: true,
      data: {
        connected: true,
        channelId: yt.channelId,
        channelTitle: yt.channelTitle,
        channels: yt.channels,
      },
    });
  }

  // Otherwise try selecting a different connected account.
  const account = (user.youtubeAccounts || []).find((item) => item.channelId === channelId);
  if (account) {
    user.youtube = account;
    await user.save();
    return res.status(200).json({
      success: true,
      data: {
        connected: true,
        channelId: account.channelId,
        channelTitle: account.channelTitle,
        channels: account.channels || [],
      },
    });
  }

  const err = new Error('Selected channel is not available');
  err.statusCode = 400;
  throw err;
});

// ---------- YouTube OAuth: disconnect ----------
export const youtubeDisconnect = asyncHandler(async (req, res) => {
  req.user.youtube = {
    channelId: null,
    channelTitle: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    connectedAt: null,
  };
  await req.user.save();
  res.status(200).json({ success: true, message: 'YouTube disconnected' });
});

// ---------- Helper to connect state with user (called from route via middleware) ----------
export const prepareYouTubeConnect = asyncHandler(async (req, res, next) => {
  // Set a cookie identifying the authenticated user for the OAuth callback.
  res.cookie('yt_oauth_user', req.user._id.toString(), {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  next();
});

// Re-export refresh for internal use
export { refreshYouTubeAccessToken };
