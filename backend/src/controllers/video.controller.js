import { asyncHandler } from '../utils/asyncHandler.js';
import Video from '../models/Video.js';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { transcribeAudio } from '../services/transcription.service.js';
import { analyzeTranscript, answerQuestion, translateTranscriptSegments } from '../services/aiMetadata.service.js';
import { generateDubbedVideo } from '../services/dubbing.service.js';

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

    // Prefer an optimized, low-bandwidth MP3 derived from the Cloudinary video. This
    // keeps us below the Whisper API request-size limit for large source videos.
    // eslint-disable-next-line no-unused-vars
    const publicUrl = video.publicUrl;
    let fetchUrl = publicUrl;
    if (publicUrl.includes('/video/upload/')) {
      fetchUrl = publicUrl
        .replace('/video/upload/', '/video/upload/ac_mp3/')
        .replace(/\\.[^/.]+$/, '.mp3');
    }

    let response = await fetch(fetchUrl);
    if (!response.ok && fetchUrl !== publicUrl) {
      // Fall back to the original file if derivation isn't available.
      response = await fetch(publicUrl);
      fetchUrl = publicUrl;
    }
    if (!response.ok) {
      throw new Error(`Failed to download video for transcription (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await transcribeAudio({
      buffer,
      filename: fetchUrl.endsWith('.mp3') ? 'audio.mp3' : (video.originalFilename || 'video.mp4'),
      mimeType: fetchUrl.endsWith('.mp3') ? 'audio/mpeg' : video.mimeType,
      language: video.originalLanguage || video.transcriptLanguage || 'en',
    });

    video.transcript = result.text || '';
    video.transcriptLanguage = result.language || video.originalLanguage || 'en';
    video.transcriptSegments = (result.segments || [])
      .map((s) => ({
        start: Number(s.start) || 0,
        end: Number(s.end) || 0,
        text: String(s.text || '').trim(),
      }))
      .filter((s) => s.text);
    video.currentStage = 'transcribed';
    video.progress = 40;
    await video.save();

    // AI analysis (titles, summary, chapters, tags, key points, action items,
    // decisions, open questions) using the transcript.
    video.currentStage = 'analysis';
    video.progress = 65;
    await video.save();

    if (video.transcript.trim()) {
      const ai = await analyzeTranscript({
        transcript: video.transcript,
        title: video.title,
        originalLanguage: video.transcriptLanguage || video.originalLanguage || 'en',
      });

      video.aiMetadata = {
        ...video.aiMetadata,
        titles: ai.titles,
        descriptions: ai.descriptions,
        tags: ai.tags,
        chapters: ai.chapters,
        summary: ai.summary,
        keyPoints: ai.keyPoints,
        actionItems: ai.actionItems,
        decisions: ai.decisions,
        openQuestions: ai.openQuestions,
        language: video.transcriptLanguage || 'en',
        model: ai.model,
        generatedAt: new Date(),
      };
    }

    // Translations (subtitle/transcript variants for requested target languages).
    if (Array.isArray(video.targetLanguages) && video.targetLanguages.length > 0 && video.transcriptSegments.length > 0) {
      video.currentStage = 'translation';
      video.progress = 85;
      await video.save();

      const translations = [];
      for (const language of video.targetLanguages) {
        try {
          const segments = await translateTranscriptSegments({
            segments: video.transcriptSegments,
            targetLanguage: language,
          });
          translations.push({
            language,
            transcript: segments.map((s) => s.text).join(' '),
            segments,
          });
        } catch (error) {
          // Keep processing successful even if one translation fails.
          console.error(`[processVideo] translation failed for ${language}:`, error?.message);
        }
      }
      video.translations = translations;
    }

    video.status = 'completed';
    video.currentStage = 'translated';
    video.progress = 100;
    video.processingCompletedAt = new Date();
    await video.save();
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

export const answerVideoQuestion = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id).select('+transcript');
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    const err = new Error('Not authorized');
    err.statusCode = 403;
    throw err;
  }

  const question = String(req.body?.question || '').trim();
  if (!question) {
    const err = new Error('Question is required');
    err.statusCode = 400;
    throw err;
  }

  const answer = await answerQuestion({ transcript: video.transcript, question });
  res.status(200).json({
    success: true,
    data: { answer, question, videoId: video._id },
  });
});

const UPDATE_FIELDS = [
  'title',
  'description',
  'originalLanguage',
  'targetLanguages',
  'youtubeVisibility',
  'youtubeCategoryId',
  'scheduledPublishAt',
  'publishedTitle',
  'publishedDescription',
  'publishedTags',
  'transcript',
];

export const updateVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    const err = new Error('Not authorized to update this video');
    err.statusCode = 403;
    throw err;
  }

  const body = req.body || {};
  for (const field of UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      if (field === 'targetLanguages' || field === 'publishedTags') {
        video[field] = normalizeLanguages(body[field]);
      } else if (field === 'scheduledPublishAt') {
        video[field] = body[field] ? new Date(body[field]) : null;
      } else {
        video[field] = body[field];
      }
    }
  }

  if (body.aiMetadata && typeof body.aiMetadata === 'object') {
    const current = video.aiMetadata ? video.aiMetadata.toObject() : {};
    video.aiMetadata = { ...current, ...body.aiMetadata };
  }

  await video.save();
  const saved = await Video.findById(video._id).lean();
  res.status(200).json({ success: true, message: 'Video updated', data: { video: saved } });
});

const isOwnerOrAdminVideo = (video, user) =>
  video.user.toString() === user._id.toString() || user.role === 'admin';

const runDubbing = async (videoId, language) => {
  const video = await Video.findById(videoId);
  if (!video) return;

  try {
    video.dubbing = {
      language,
      status: 'processing',
      progress: 10,
      error: null,
      startedAt: video.dubbing?.startedAt || new Date(),
      completedAt: null,
    };
    await video.save();

    const dub = await generateDubbedVideo({ video, language });

    video.dubbing = {
      language,
      status: 'completed',
      progress: 100,
      error: null,
      startedAt: video.dubbing?.startedAt || new Date(),
      completedAt: new Date(),
    };

    const existing = (video.dubs || []).filter((d) => d.language !== language);
    video.dubs = [...existing, dub];
    await video.save();
  } catch (error) {
    video.dubbing = {
      language,
      status: 'failed',
      progress: video.dubbing?.progress || 0,
      error: error?.message || 'Dubbing failed',
      startedAt: video.dubbing?.startedAt || new Date(),
      completedAt: new Date(),
    };
    await video.save();
  }
};

export const dubVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error('Video not found');
    err.statusCode = 404;
    throw err;
  }
  if (!isOwnerOrAdminVideo(video, req.user)) {
    const err = new Error('Not authorized to dub this video');
    err.statusCode = 403;
    throw err;
  }

  const language = String(req.body?.language || video.targetLanguages?.[0] || video.transcriptLanguage || 'en').trim();
  if (!language) {
    const err = new Error('Target language is required');
    err.statusCode = 400;
    throw err;
  }

  const hasTranslation = (video.translations || []).some((t) => t.language === language);
  const hasTranscript = Boolean((video.transcript || '').trim());
  if (!hasTranslation && !hasTranscript) {
    const err = new Error('Process the video first to generate a transcript/translation');
    err.statusCode = 400;
    throw err;
  }

  video.dubbing = {
    language,
    status: 'processing',
    progress: 5,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };
  await video.save();

  runDubbing(video._id, language).catch((err) => {
    console.error('[dubVideo] pipeline error:', err);
  });

  res.status(202).json({
    success: true,
    message: `Dubbing started for ${language}`,
    data: { video: await Video.findById(video._id).lean() },
  });
});

export const getProcessingLabel = (stage) => STAGE_LABELS[stage] || stage || 'Processing';