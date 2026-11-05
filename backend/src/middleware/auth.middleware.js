import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../utils/token.js';
import User from '../models/User.js';

export const protect = asyncHandler(async (req, res, next) => {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    const err = new Error('Not authorized, no token provided');
    err.statusCode = 401;
    throw err;
  }

  const decoded = verifyAccessToken(token);
  const user = await User.findById(decoded.id);

  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 401;
    throw err;
  }

  if (!user.isActive) {
    const err = new Error('User account is deactivated');
    err.statusCode = 403;
    throw err;
  }

  req.user = user;
  next();
});

export const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    const err = new Error('Admin access required');
    err.statusCode = 403;
    throw err;
  }
  next();
};

export const optionalAuth = asyncHandler(async (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split(' ')[1];
  else if (req.cookies?.accessToken) token = req.cookies.accessToken;

  if (!token) return next();

  try {
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id);
    if (user && user.isActive) req.user = user;
  } catch {
    // ignore invalid token for optional auth
  }
  next();
});
