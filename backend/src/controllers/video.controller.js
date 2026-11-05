import { asyncHandler } from '../utils/asyncHandler.js';
import Video from '../models/Video.js';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { transcribeAudio } from '../services/transcription.service.js';

const STAGE_LABELS = {
  queued: 'Queued for processing',
  transcription: 'Transcribing audio with Whisper...',
  transcribed: 'Transcription complete. Next: AI metadata generation.',
  analysis: 'Generating titles, chapters, tags with AI...',
  analyzed: 'AI metadata ready. Next: translation.',
  translation: 'Translating transcript...',
  translated: 'Translations ready. Next: YouTube publishing.',
  publishing: 'Publishing to YouTube...',
  published: 'Published to YouTube.',
  completed: 'Completed',
  failed: 'Processing failed',
};

const uploadBuffer = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, response) => {
      if (error) return reject(error);
      resolve(response);
    });
    stream.end(buffer);
  });

const normalizeLanguages = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  const str = String(value).trim();
  // Support JSON-encoded arrays sent from the client.
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((v) => v.trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return str
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
};

const normalizeLinks = (value) => {
  if (!value) return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value
        .split(/\n/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((url) => ({ name: url, url }));
    }
  }
  if (!Array.isArray(parsed)) parsed = [parsed];
  return parsed
    .map((item) => {
      if (typeof item === 'string') return { name: item, url: item };
      if (item && item.url) return { name: item.name || item.url, url: item.url };
      return null;
    })
    .filter(Boolean);
};

export const uploadVideo = asyncHandler(async (req, res) => {
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured on the server');
    err.statusCode = 500;
    throw err;
  }

  const videoFile = req.files?.video?.[0];
  if (!videoFile) {
    const err = new Error('No video file provided (field name: "video")');
    err.statusCode = 400;
    throw err;
  }

  const title = (req.body?.title || videoFile.originalname || '').toString().trim();
  const description = (req.body?.description || '').toString().trim();
  const originalLanguage = (req.body?.originalLanguage || 'en').toString().trim() || 'en';
  const targetLanguages = normalizeLanguages(req.body?.targetLanguages);
  const links = normalizeLinks(req.body?.links);

  // Upload main video.
  let videoResult;
  try {
    videoResult = await uploadBuffer(videoFile.buffer, {
      resource_type: 'video',
      folder: env.cloudinaryFolder,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });
  } catch (error) {
    const err = new Error(error?.message || 'Cloudinary video upload failed');
    err.statusCode = 502;
    throw err;
  }

  // Upload attachments.
  const attachmentFiles = req.files?.attachments || [];
  const attachments = [];

  // Links first.
  for (const link of links) {
    attachments.push({
      name: link.name,
      type: 'link',
      url: link.url,
      publicId: null,
      sizeBytes: 0,
      mimeType: null,
    });
  }

  for (const file of attachmentFiles) {
    try {
      const resourceType = file.mimetype.startsWith('image/') ? 'image' : 'raw';
      const result = await uploadBuffer(file.buffer, {
        resource_type: resourceType,
        folder: `${env.cloudinaryFolder}/attachments`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      });
      attachments.push({
        name: file.originalname,
        type: 'file',
        url: result.secure_url,
        publicId: result.public_id,
        sizeBytes: file.size,
        mimeType: file.mimetype,
      });
    } catch (error) {
      // Skip failed attachments but keep the video; report in response.
      attachments.push({
        name: file.originalname,
        type: 'file',
        url: null,
        publicId: null,
        sizeBytes: file.size,
        mimeType: file.mimetype,
        // store error in name? We'll just skip nulls later.
      });
    }
  }

  // Filter out attachments that failed to upload (url null).
  const cleanAttachments = attachments.filter((a) => a.url);

  const video = await Video.create({
    user: req.user._id,
    title,
    description,
    originalFilename: videoFile.originalname,
    mimeType: videoFile.mimetype,
    sizeBytes: videoFile.size,
    publicUrl: videoResult.secure_url,
    storagePath: videoResult.public_id,
    durationSeconds: Math.round(videoResult.duration || 0),
    thumbnailUrl: videoResult.eager?.[0]?.secure_url || null,
    originalLanguage,
    targetLanguages,
    attachments: cleanAttachments,
    status: 'pending',
    currentStage: 'uploaded',
    progress: 0,
  });

  res.status(201).json({ success: true, message: 'Video uploaded', data: { video } });
});

export const listMyVideos = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { user: req.user._id };

  const [items, total] = await Promise.all([
    Video.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Video.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
  });
});

export const getVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id).lean();
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    const err = new Error('Not authorized to view this video');
    err.statusCode = 403;
    throw err;
  }
  res.status(200).json({ success: true, data: { video } });
});

export const deleteVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    const err = new Error('Not authorized to delete this video');
    err.statusCode = 403;
    throw err;
  }

  try {
    if (video.storagePath) {
      await cloudinary.uploader.destroy(video.storagePath, { resource_type: 'video' });
    }
    for (const att of video.attachments || []) {
      if (att.publicId) {
        const rt = att.mimeType?.startsWith('image/') ? 'image' : 'raw';
        await cloudinary.uploader.destroy(att.publicId, { resource_type: rt });
      }
    }
  } catch {
    // ignore
  }

  await video.deleteOne();
  res.status(200).json({ success: true, message: 'Video deleted' });
});

const isOwnerOrAdmin = (video, user) =>
  video.user.toString() === user._id.toString() || user.role === 'admin';

const runPipeline = async (videoId) => {
  const video = await Video.findById(videoId);
  if (!video) return;

  try {
    video.status = 'processing';
    video.currentStage = 'transcription';
    video.progress = 10;
    video.processingStartedAt = video.processingStartedAt || new Date();
    video.lastError = null;
    await video.save();

    if (!video.publicUrl) {
      throw new Error('No uploaded video URL available for transcription');
    }

    const response = await fetch(video.publicUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video for transcription (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await transcribeAudio({
      buffer,
      filename: video.originalFilename || 'video.mp4',
      mimeType: video.mimeType,
      language: video.originalLanguage || video.transcriptLanguage || 'en',
    });

    video.transcript = result.text || '';
    video.transcriptLanguage = result.language || video.originalLanguage || 'en';
    video.currentStage = 'transcribed';
    video.progress = 40;
    video.processingCompletedAt = null;
    await video.save();

    // Subsequent steps (AI analysis, translation, publishing) will be appended here.
  } catch (error) {
    video.status = 'failed';
    video.currentStage = 'failed';
    video.lastError = {
      message: error?.message || 'Transcription failed',
      stage: 'transcription',
      occurredAt: new Date(),
    };
    await video.save();
  }
};

export const processVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }
  if (!isOwnerOrAdmin(video, req.user)) {
    const err = new Error('Not authorized to process this video');
    err.statusCode = 403;
    throw err;
  }

  // Allow re-running failed processing.
  if (video.status === 'processing') {
    return res.status(202).json({
      success: true,
      message: 'Video is already processing',
      data: { video },
    });
  }

  video.status = 'processing';
  video.currentStage = 'queued';
  video.progress = 5;
  video.lastError = null;
  await video.save();

  // Fire and forget; client polls GET /api/videos/:id for status.
  runPipeline(video._id).catch((err) => {
    console.error('[processVideo] pipeline error:', err);
  });

  res.status(202).json({
    success: true,
    message: 'Processing started',
    data: { video },
  });
});

export const getProcessingLabel = (stage) => STAGE_LABELS[stage] || stage || 'Processing';