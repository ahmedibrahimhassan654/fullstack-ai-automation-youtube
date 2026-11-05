import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.js';
import Video from '../models/Video.js';

export const getStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    adminUsers,
    activeUsers,
    totalVideos,
    videosByStatus,
    connectedChannels,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ isActive: true }),
    Video.countDocuments(),
    Video.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.countDocuments({ 'youtube.channelId': { $ne: null } }),
  ]);

  const statusMap = videosByStatus.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      users: {
        total: totalUsers,
        admins: adminUsers,
        active: activeUsers,
        connectedYouTube: connectedChannels,
      },
      videos: {
        total: totalVideos,
        pending: statusMap.pending || 0,
        processing: statusMap.processing || 0,
        completed: statusMap.completed || 0,
        failed: statusMap.failed || 0,
      },
    },
  });
});

export const getUsers = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.role && ['user', 'admin'].includes(req.query.role)) filter.role = req.query.role;
  if (req.query.search) {
    const q = String(req.query.search).trim();
    filter.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }];
  }
  if (req.query.active !== undefined) filter.isActive = req.query.active === 'true';

  const [items, total] = await Promise.all([
    User.find(filter)
      .select('-password -sessionRefreshToken -youtube.accessToken -youtube.refreshToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

export const updateUserRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body || {};
  if (!['user', 'admin'].includes(role)) {
    const err = new Error('Invalid role');
    err.statusCode = 400;
    throw err;
  }
  if (id === req.user._id.toString() && role !== 'admin') {
    const err = new Error('You cannot remove your own admin role');
    err.statusCode = 400;
    throw err;
  }
  const user = await User.findByIdAndUpdate(id, { role }, { new: true })
    .select('-password -sessionRefreshToken -youtube.accessToken -youtube.refreshToken');
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  res.status(200).json({ success: true, data: { user } });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body || {};
  if (typeof isActive !== 'boolean') {
    const err = new Error('isActive must be boolean');
    err.statusCode = 400;
    throw err;
  }
  if (id === req.user._id.toString() && isActive === false) {
    const err = new Error('You cannot deactivate your own account');
    err.statusCode = 400;
    throw err;
  }
  const user = await User.findByIdAndUpdate(id, { isActive }, { new: true })
    .select('-password -sessionRefreshToken -youtube.accessToken -youtube.refreshToken');
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  res.status(200).json({ success: true, data: { user } });
});

export const getVideos = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status && ['pending', 'processing', 'completed', 'failed'].includes(req.query.status)) {
    filter.status = req.query.status;
  }
  if (req.query.userId) filter.user = req.query.userId;

  const [items, total] = await Promise.all([
    Video.find(filter)
      .populate('user', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Video.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

export const deleteVideo = asyncHandler(async (req, res) => {
  const video = await Video.findByIdAndDelete(req.params.id);
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }
  res.status(200).json({ success: true, message: 'Video deleted' });
});