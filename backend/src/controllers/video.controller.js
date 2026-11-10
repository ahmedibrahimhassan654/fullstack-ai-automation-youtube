import { asyncHandler } from "../utils/asyncHandler.js";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
import Video from "../models/Video.js";
import cloudinary, { isCloudinaryConfigured } from "../config/cloudinary.js";
import { env } from "../config/env.js";
import { transcribeAudio } from "../services/transcription.service.js";
import { publishProgress, subscribeProgress } from "../lib/progressBus.js";
import {
  analyzeTranscript,
  answerQuestion,
  translateTranscriptSegments,
  translatePublishMetadata,
} from "../services/aiMetadata.service.js";
import { generateDubbedVideo } from "../services/dubbing.service.js";
import { EDGE_VOICE_OPTIONS, VOICES } from "../services/tts.service.js";
import { parseSubtitle } from "../services/subtitle.service.js";
import { generateLessonVideo } from "../services/lessonVideo.service.js";
import { ElevenLabsClient } from "elevenlabs";
import {
  addVideoToPlaylist,
  getValidYouTubeAccessToken,
  listYouTubeComments as fetchYouTubeComments,
  listYouTubePlaylists as fetchYouTubePlaylists,
  publishYouTubeVideo,
  updateYouTubeVideo,
  deletePlaylistItem,
  youtubeFetch,
  setYouTubeThumbnail,
  replyYouTubeComment as replyToYouTubeComment,
} from "../services/youtubePublish.service.js";
import User from "../models/User.js";

const emitVideoProgress = (video) => {
  if (!video) return;
  const videoId = String(video._id || video.id);
  const payload = {
    type: "video:progress",
    videoId,
    status: video.status,
    currentStage: video.currentStage,
    progress: video.progress,
    lastError: video.lastError,
    dubbing: video.dubbing,
    lessonGeneration: video.lessonGeneration,
    dubs: video.dubs,
    lessonVideos: video.lessonVideos,
    transcript: video.transcript,
    transcriptSegments: video.transcriptSegments,
    translations: video.translations,
    aiMetadata: video.aiMetadata,
  };
  publishProgress(`video:${videoId}`, payload);
  if (video.user) publishProgress(`user:${video.user}`, payload);
};

const STAGE_LABELS = {
  queued: "Queued for processing",
  transcription: "Transcribing audio with Whisper...",
  transcribed: "Transcription complete. Next: AI metadata generation.",
  analysis: "Generating titles, chapters, tags with AI...",
  analyzed: "AI metadata ready. Next: translation.",
  translation: "Translating transcript...",
  translated: "Translations ready. Next: YouTube publishing.",
  publishing: "Publishing to YouTube...",
  published: "Published to YouTube.",
  completed: "Completed",
  failed: "Processing failed",
};

const uploadBuffer = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, response) => {
        if (error) return reject(error);
        resolve(response);
      },
    );
    stream.end(buffer);
  });

const normalizeLanguages = (value) => {
  if (!value) return [];
  if (Array.isArray(value))
    return value
      .map(String)
      .map((v) => v.trim())
      .filter(Boolean);
  const str = String(value).trim();
  // Support JSON-encoded arrays sent from the client.
  if (str.startsWith("[")) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed
          .map(String)
          .map((v) => v.trim())
          .filter(Boolean);
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
  if (typeof value === "string") {
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
      if (typeof item === "string") return { name: item, url: item };
      if (item && item.url)
        return { name: item.name || item.url, url: item.url };
      return null;
    })
    .filter(Boolean);
};

export const uploadVideo = asyncHandler(async (req, res) => {
  if (!isCloudinaryConfigured()) {
    const err = new Error("Cloudinary is not configured on the server");
    err.statusCode = 500;
    throw err;
  }

  const videoFile = req.files?.video?.[0];
  if (!videoFile) {
    const err = new Error('No video file provided (field name: "video")');
    err.statusCode = 400;
    throw err;
  }

  const title = (req.body?.title || videoFile.originalname || "")
    .toString()
    .trim();
  const description = (req.body?.description || "").toString().trim();
  const originalLanguage =
    (req.body?.originalLanguage || "en").toString().trim() || "en";
  const targetLanguages = normalizeLanguages(req.body?.targetLanguages);
  const links = normalizeLinks(req.body?.links);

  const subtitleFile =
    req.files?.subtitle?.[0] ||
    req.files?.subtitles?.[0] ||
    req.files?.srt?.[0] ||
    req.files?.srtFile?.[0] ||
    req.files?.caption?.[0] ||
    req.files?.captions?.[0] ||
    null;
  let parsedSubtitle = null;
  if (subtitleFile) {
    try {
      parsedSubtitle = parseSubtitle(
        subtitleFile.buffer.toString("utf8"),
        subtitleFile.originalname,
      );
    } catch (error) {
      console.error("[uploadVideo] subtitle parse failed:", error?.message);
      parsedSubtitle = null;
    }
  }

  // Upload main video.
  let videoResult;
  try {
    videoResult = await uploadBuffer(videoFile.buffer, {
      resource_type: "video",
      folder: env.cloudinaryFolder,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });
  } catch (error) {
    const isTooLarge =
      error?.http_code === 413 ||
      /413/.test(String(error?.message || "")) ||
      /too large/i.test(String(error?.message || ""));
    const err = new Error(
      isTooLarge
        ? "Video is too large for Cloudinary (account upload limit exceeded). Please compress or trim the video (for example under ~100MB) and try again."
        : error?.message || "Cloudinary video upload failed",
    );
    err.statusCode = isTooLarge ? 413 : 502;
    throw err;
  }

  // Upload attachments.
  const attachmentFiles = req.files?.attachments || [];
  const attachments = [];

  // Links first.
  for (const link of links) {
    attachments.push({
      name: link.name,
      type: "link",
      url: link.url,
      publicId: null,
      sizeBytes: 0,
      mimeType: null,
    });
  }

  for (const file of attachmentFiles) {
    try {
      const resourceType = file.mimetype.startsWith("image/") ? "image" : "raw";
      const result = await uploadBuffer(file.buffer, {
        resource_type: resourceType,
        folder: `${env.cloudinaryFolder}/attachments`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      });
      attachments.push({
        name: file.originalname,
        type: "file",
        url: result.secure_url,
        publicId: result.public_id,
        sizeBytes: file.size,
        mimeType: file.mimetype,
      });
    } catch (error) {
      // Skip failed attachments but keep the video; report in response.
      attachments.push({
        name: file.originalname,
        type: "file",
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

  // Upload original subtitle (SRT/VTT) if provided.
  const subtitleEntries = [];
  if (subtitleFile) {
    try {
      const result = await uploadBuffer(subtitleFile.buffer, {
        resource_type: "raw",
        folder: `${env.cloudinaryFolder}/subtitles`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      });
      subtitleEntries.push({
        language: originalLanguage,
        url: result.secure_url,
        path: result.public_id,
      });
    } catch (error) {
      console.error("[uploadVideo] subtitle upload failed:", error?.message);
    }
  }

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
    subtitles: subtitleEntries,
    transcript: parsedSubtitle?.text || "",
    transcriptSegments: parsedSubtitle?.segments || [],
    transcriptLanguage: parsedSubtitle ? originalLanguage : "en",
    status: "pending",
    currentStage: "uploaded",
    progress: 0,
  });

  res
    .status(201)
    .json({ success: true, message: "Video uploaded", data: { video } });
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
    data: {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

export const getVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id).lean();
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (
    video.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    const err = new Error("Not authorized to view this video");
    err.statusCode = 403;
    throw err;
  }
  res.status(200).json({ success: true, data: { video } });
});

export const deleteVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (
    video.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    const err = new Error("Not authorized to delete this video");
    err.statusCode = 403;
    throw err;
  }

  try {
    if (video.storagePath) {
      await cloudinary.uploader.destroy(video.storagePath, {
        resource_type: "video",
      });
    }
    for (const att of video.attachments || []) {
      if (att.publicId) {
        const rt = att.mimeType?.startsWith("image/") ? "image" : "raw";
        await cloudinary.uploader.destroy(att.publicId, { resource_type: rt });
      }
    }
    for (const sub of video.subtitles || []) {
      if (sub.path) {
        await cloudinary.uploader.destroy(sub.path, { resource_type: "raw" });
      }
    }
    for (const dub of video.dubs || []) {
      if (dub.storagePath) {
        await cloudinary.uploader.destroy(dub.storagePath, {
          resource_type: "video",
        });
      }
    }
    for (const lesson of video.lessonVideos || []) {
      if (lesson.storagePath) {
        await cloudinary.uploader.destroy(lesson.storagePath, {
          resource_type: "video",
        });
      }
      if (lesson.subtitlesUrl) {
        // Best effort: lesson VTT is raw, but public ID isn't stored; ignore.
      }
    }
  } catch {
    // ignore
  }

  await video.deleteOne();
  res.status(200).json({ success: true, message: "Video deleted" });
});

const isOwnerOrAdmin = (video, user) =>
  video.user.toString() === user._id.toString() || user.role === "admin";

export const runPipeline = async (videoId) => {
  const video = await Video.findById(videoId);
  if (!video) return;
  if (video.status !== "processing") return;

  try {
    const originalLanguage = video.transcriptLanguage || video.originalLanguage || "en";
    const hasTranscript =
      Array.isArray(video.transcriptSegments) &&
      video.transcriptSegments.length > 0 &&
      String(video.transcript || "").trim().length > 0;
    const hasAiMetadata = Boolean(video.aiMetadata?.summary);
    const targetLanguages = Array.isArray(video.targetLanguages)
      ? video.targetLanguages
      : [];
    const translatedLanguageSet = new Set((video.translations || []).map((t) => t.language));
    const translationComplete =
      targetLanguages.length === 0 ||
      targetLanguages.every((lang) => translatedLanguageSet.has(lang));

    video.status = "processing";
    video.lastError = null;
    video.processingStartedAt = video.processingStartedAt || new Date();

    const saveVideo = async (nextStage, nextProgress) => {
      if (nextStage) video.currentStage = nextStage;
      if (typeof nextProgress === "number") video.progress = nextProgress;
      await video.save();
      emitVideoProgress(video);
    };

    if (!hasTranscript) {
      await saveVideo("transcription", 10);

      if (!video.publicUrl) {
        throw new Error("No uploaded video URL available for transcription");
      }

      let fetchUrl = video.publicUrl;
      if (video.publicUrl.includes("/video/upload/")) {
        fetchUrl = video.publicUrl
          .replace("/video/upload/", "/video/upload/ac_mp3/")
          .replace(/\.[^/.]+$/, ".mp3");
      }

      let response = await fetch(fetchUrl, { signal: AbortSignal.timeout(300000) });
      if (!response.ok && fetchUrl !== video.publicUrl) {
        response = await fetch(video.publicUrl, { signal: AbortSignal.timeout(300000) });
        fetchUrl = video.publicUrl;
      }
      if (!response.ok) {
        throw new Error(`Failed to download video for transcription (${response.status})`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result = await transcribeAudio({
        buffer,
        filename: fetchUrl.endsWith(".mp3") ? "audio.mp3" : video.originalFilename || "video.mp4",
        mimeType: fetchUrl.endsWith(".mp3") ? "audio/mpeg" : video.mimeType,
        language: video.originalLanguage || video.transcriptLanguage || "en",
      });

      video.transcript = result.text || "";
      video.transcriptLanguage = result.language || video.originalLanguage || "en";
      video.transcriptSegments = (result.segments || [])
        .map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || "").trim(),
        }))
        .filter((s) => s.text);
      await saveVideo("transcribed", 40);
    } else {
      if (!video.currentStage || video.currentStage === "queued" || video.currentStage === "uploaded") {
        await saveVideo("transcribed", 40);
      }
    }

    if (!hasAiMetadata && String(video.transcript || "").trim()) {
      await saveVideo("analysis", 65);
      const ai = await analyzeTranscript({
        transcript: video.transcript,
        title: video.title,
        originalLanguage: video.transcriptLanguage || video.originalLanguage || "en",
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
        language: video.transcriptLanguage || "en",
        model: ai.model,
        generatedAt: new Date(),
      };
      await saveVideo("analyzed", 70);
    }

    const remainingLanguages = targetLanguages.filter((lang) => !translatedLanguageSet.has(lang));
    if (remainingLanguages.length > 0) {
      await saveVideo("translation", 85);

      // Prefer fast translation for many-languages / long-transcript videos.
      const fastTranslation =
        targetLanguages.length > 3 ||
        (Array.isArray(video.transcriptSegments) && video.transcriptSegments.length > 12);

      for (const language of remainingLanguages) {
        try {
          const segments = await translateTranscriptSegments({
            segments: video.transcriptSegments,
            targetLanguage: language,
            originalLanguage: video.transcriptLanguage || video.originalLanguage || "en",
            fast: fastTranslation,
          });

          if (video.durationSeconds > 0 && segments.length > 0) {
            const last = segments[segments.length - 1];
            last.end = Math.max(Number(last.end) || 0, video.durationSeconds);
          }

          const qualityScores = segments
            .map((s) => s.qualityScore)
            .filter((n) => typeof n === "number");
          const avgQuality =
            qualityScores.length > 0
              ? qualityScores.reduce((sum, n) => sum + n, 0) / qualityScores.length
              : null;

          const translation = {
            language,
            transcript: segments.map((s) => s.text).join(" "),
            segments,
            qualityScore: avgQuality,
            qualityStatus:
              qualityScores.length === 0
                ? "unknown"
                : segments.every((s) => s.qualityStatus !== "failed")
                ? "passed"
                : "failed",
            translationAttempts: Math.max(1, ...segments.map((s) => s.translationAttempts || 1)),
          };

          if (!Array.isArray(video.translations)) video.translations = [];
          video.translations = [
            ...(video.translations || []).filter((t) => t.language !== language),
            translation,
          ];
          translatedLanguageSet.add(language);
          await saveVideo("translation", 85);
        } catch (error) {
          console.error(`[processVideo] translation failed for ${language}:`, error?.message);
        }
      }
    }

    video.status = "completed";
    video.currentStage = "translated";
    video.progress = 100;
    video.processingCompletedAt = new Date();
    await saveVideo("translated", 100);
  } catch (error) {
    video.status = "failed";
    video.currentStage = video.currentStage || "failed";
    video.lastError = {
      message: error?.message || "Processing failed",
      stage: video.currentStage || "processing",
      occurredAt: new Date(),
    };
    await video.save();
    emitVideoProgress(video);
  }
};

export const processVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (!isOwnerOrAdmin(video, req.user)) {
    const err = new Error("Not authorized to process this video");
    err.statusCode = 403;
    throw err;
  }

  // Allow re-running failed processing.
  if (video.status === "processing") {
    return res.status(202).json({
      success: true,
      message: "Video is already processing",
      data: { video },
    });
  }

  video.status = "processing";
  video.currentStage = "queued";
  video.progress = 5;
  video.lastError = null;
  await video.save();
  emitVideoProgress(video);
  emitVideoProgress(video);

  // Fire and forget; clients receive SSE progress updates.
  runPipeline(video._id).catch((err) => {
    console.error("[processVideo] pipeline error:", err);
  });

  res.status(202).json({
    success: true,
    message: "Processing started",
    data: { video },
  });
});

export const answerVideoQuestion = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id).select("+transcript");
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (
    video.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    const err = new Error("Not authorized");
    err.statusCode = 403;
    throw err;
  }

  const question = String(req.body?.question || "").trim();
  if (!question) {
    const err = new Error("Question is required");
    err.statusCode = 400;
    throw err;
  }

  const answer = await answerQuestion({
    transcript: video.transcript,
    question,
  });
  res.status(200).json({
    success: true,
    data: { answer, question, videoId: video._id },
  });
});

const UPDATE_FIELDS = [
  "title",
  "description",
  "originalLanguage",
  "targetLanguages",
  "youtubeVisibility",
  "youtubeCategoryId",
  "scheduledPublishAt",
  "publishedTitle",
  "publishedDescription",
  "publishedTags",
  "transcript",
];

export const updateVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (
    video.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    const err = new Error("Not authorized to update this video");
    err.statusCode = 403;
    throw err;
  }

  const body = req.body || {};
  for (const field of UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      if (field === "targetLanguages" || field === "publishedTags") {
        video[field] = normalizeLanguages(body[field]);
      } else if (field === "scheduledPublishAt") {
        video[field] = body[field] ? new Date(body[field]) : null;
      } else {
        video[field] = body[field];
      }
    }
  }

  if (body.aiMetadata && typeof body.aiMetadata === "object") {
    const current = video.aiMetadata ? video.aiMetadata.toObject() : {};
    video.aiMetadata = { ...current, ...body.aiMetadata };
  }

  await video.save();
  emitVideoProgress(video);
  const saved = await Video.findById(video._id).lean();
  res
    .status(200)
    .json({ success: true, message: "Video updated", data: { video: saved } });
});

const isOwnerOrAdminVideo = (video, user) =>
  video.user.toString() === user._id.toString() || user.role === "admin";

const runDubbing = async (videoId, language, elevenLabsVoiceId = null, edgeVoice = null) => {
  const video = await Video.findById(videoId);
  if (!video) return;

  // Translate on demand so dubbing works for languages requested at dub time.
  const hasTranslation = (video.translations || []).some(
    (t) => t.language === language,
  );
  if (
    !hasTranslation &&
    language !== (video.originalLanguage || "en") &&
    Array.isArray(video.transcriptSegments) &&
    video.transcriptSegments.length > 0
  ) {
    try {
      const segments = await translateTranscriptSegments({
        segments: video.transcriptSegments,
        targetLanguage: language,
        originalLanguage: video.transcriptLanguage || video.originalLanguage || "en",
      });
      if (video.durationSeconds > 0 && segments.length > 0) {
        const last = segments[segments.length - 1];
        last.end = Math.max(Number(last.end) || 0, video.durationSeconds);
      }
      const qualityScores = segments
        .map((s) => s.qualityScore)
        .filter((n) => typeof n === "number");
      const avgQuality =
        qualityScores.length > 0
          ? qualityScores.reduce((sum, n) => sum + n, 0) / qualityScores.length
          : null;
      video.translations = [
        ...(video.translations || []),
        {
          language,
          transcript: segments.map((s) => s.text).join(" "),
          segments,
          qualityScore: avgQuality,
          qualityStatus:
            qualityScores.length === 0
              ? "unknown"
              : segments.every((s) => s.qualityStatus !== "failed")
              ? "passed"
              : "failed",
          translationAttempts: Math.max(
            1,
            ...segments.map((s) => s.translationAttempts || 1),
          ),
        },
      ];
      await video.save();
      emitVideoProgress(video);
    } catch (translationError) {
      // Fall back to the original transcript if translation is unavailable.
      console.error(
        "[runDubbing] translation failed:",
        translationError?.message,
      );
    }
  }

  try {
    video.dubbing = {
      language,
      status: "processing",
      progress: 10,
      error: null,
      startedAt: video.dubbing?.startedAt || new Date(),
      completedAt: null,
    };
    await video.save();
    emitVideoProgress(video);

    let lastReportedProgress = video.dubbing?.progress ?? 10;
    const dub = await generateDubbedVideo({
      video,
      language,
      voice: edgeVoice || elevenLabsVoiceId,
      elevenLabsVoiceId,
      onProgress: async (value) => {
        if (value - lastReportedProgress < 5) return;
        lastReportedProgress = value;
        const fresh = await Video.findById(video._id).select("dubbing.status").lean();
        if (fresh?.dubbing?.status && fresh.dubbing.status !== "processing") {
          const cancelError = new Error("Dubbing cancelled by user");
          cancelError.code = "DUB_CANCELLED";
          throw cancelError;
        }
        video.dubbing.progress = value;
        await video.save();
        emitVideoProgress(video);
      },
    });

    video.dubbing = {
      language,
      status: "completed",
      progress: 100,
      error: null,
      startedAt: video.dubbing?.startedAt || new Date(),
      completedAt: new Date(),
    };

    const existing = (video.dubs || []).filter(
      (d) =>
        !(
          d.language === language &&
          String(d.voice || "") === String(dub.voice || "")
        ),
    );
    video.dubs = [...existing, dub];
    await video.save();
    emitVideoProgress(video);
  } catch (error) {
    video.dubbing = {
      language,
      status: "failed",
      progress: video.dubbing?.progress || 0,
      error: error?.message || "Dubbing failed",
      startedAt: video.dubbing?.startedAt || new Date(),
      completedAt: new Date(),
    };
    await video.save();
    emitVideoProgress(video);
  }
};

export const dubVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (!isOwnerOrAdminVideo(video, req.user)) {
    const err = new Error("Not authorized to dub this video");
    err.statusCode = 403;
    throw err;
  }

  const language = String(
    req.body?.language ||
      video.targetLanguages?.[0] ||
      video.transcriptLanguage ||
      "en",
  ).trim();
  if (!language) {
    const err = new Error("Target language is required");
    err.statusCode = 400;
    throw err;
  }

  const hasTranslation = (video.translations || []).some(
    (t) => t.language === language,
  );
  const hasTranscript = Boolean((video.transcript || "").trim());
  if (!hasTranslation && !hasTranscript) {
    const err = new Error(
      "Process the video first to generate a transcript/translation",
    );
    err.statusCode = 400;
    throw err;
  }

  video.dubbing = {
    language,
    status: "processing",
    progress: 5,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };
  await video.save();
  emitVideoProgress(video);

  const dubElevenLabsVoiceId = String(
    req.body?.voiceId || req.body?.elevenLabsVoiceId || "",
  ).trim() || null;
  const dubEdgeVoice = String(
    req.body?.voice || req.body?.edgeVoice || "",
  ).trim() || null;
  runDubbing(video._id, language, dubElevenLabsVoiceId, dubEdgeVoice).catch((err) => {
    console.error("[dubVideo] pipeline error:", err);
  });

  res.status(202).json({
    success: true,
    message: `Dubbing started for ${language}`,
    data: { video: await Video.findById(video._id).lean() },
  });
});

export const runLessonGeneration = async (
  videoId,
  language,
  voiceId = null,
  voice = null,
  backgroundOnly = false,
) => {
  const video = await Video.findById(videoId);
  if (!video) return;
  console.log("[lesson] loaded", videoId, "lang", language);

  try {
    video.lessonGeneration = {
      language,
      status: "processing",
      progress: 10,
      error: null,
      startedAt: video.lessonGeneration?.startedAt || new Date(),
      completedAt: null,
    };
    await video.save();
    emitVideoProgress(video);

    const updateProgress = async (progress) => {
      try {
        const fresh = await Video.findById(videoId);
        if (fresh) {
          fresh.lessonGeneration = {
            ...(fresh.lessonGeneration?.toObject?.() ||
              fresh.lessonGeneration ||
              {}),
            progress,
          };
          await fresh.save();
        }
      } catch {
        // best effort
      }
    };

    const lesson = await generateLessonVideo({
      video,
      language,
      voiceId,
      voice,
      backgroundOnly,
      onProgress: updateProgress,
    });

    video.lessonGeneration = {
      language,
      status: "completed",
      progress: 100,
      error: null,
      startedAt: video.lessonGeneration?.startedAt || new Date(),
      completedAt: new Date(),
    };
    // Keep dub-publish records for the same language, and keep the YouTube
    // linkage of a previous lesson render so republishing updates the existing
    // YouTube video instead of creating a duplicate.
    const previousPublish = (video.lessonVideos || []).find(
      (item) => item.language === language && (item.source || "lesson") === "lesson",
    );
    const publishKeys = [
      "youtubeVideoId",
      "youtubeUrl",
      "youtubePublishedAt",
      "youtubeChannelId",
      "youtubeChannelTitle",
      "youtubePlaylistId",
      "youtubePlaylistItemId",
      "youtubeVisibility",
      "youtubeCategoryId",
      "youtubeTitle",
      "youtubeDescription",
      "youtubeTags",
      "thumbnailUrl",
    ];
    const preservedPublish = previousPublish
      ? Object.fromEntries(
          publishKeys
            .filter((key) => previousPublish[key] !== undefined && previousPublish[key] !== null && previousPublish[key] !== "")
            .map((key) => [key, previousPublish[key]]),
        )
      : {};
    const others = (video.lessonVideos || []).filter(
      (item) => !(item.language === language && (item.source || "lesson") === "lesson"),
    );
    video.lessonVideos = [...others, { ...lesson, source: "lesson", ...preservedPublish }];
    await video.save();
    emitVideoProgress(video);
  } catch (error) {
    video.lessonGeneration = {
      language,
      status: "failed",
      progress: video.lessonGeneration?.progress || 0,
      error: error?.message || "Lesson generation failed",
      startedAt: video.lessonGeneration?.startedAt || new Date(),
      completedAt: new Date(),
    };
    await video.save();
    emitVideoProgress(video);
  }
};

export const generateLesson = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (
    video.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    const err = new Error("Not authorized to generate a lesson video");
    err.statusCode = 403;
    throw err;
  }

  const language = String(
    req.body?.language ||
      video.targetLanguages?.[0] ||
      video.transcriptLanguage ||
      "en",
  ).trim();
  const voiceId =
    String(req.body?.voiceId || req.body?.voice_id || "").trim() || null;
  const voice =
    String(req.body?.voice || req.body?.edgeVoice || "").trim() || null;
  const backgroundOnly = Boolean(
    req.body?.backgroundOnly || req.body?.background || req.body?.voiceoverOnly,
  );
  if (!language) {
    const err = new Error("Target language is required");
    err.statusCode = 400;
    throw err;
  }
  if (!(video.aiMetadata?.summary || video.transcript)) {
    const err = new Error("Process the video first to generate AI metadata");
    err.statusCode = 400;
    throw err;
  }

  video.lessonGeneration = {
    language,
    status: "processing",
    progress: 5,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };
  await video.save();
  emitVideoProgress(video);

  runLessonGeneration(video._id, language, voiceId, voice, backgroundOnly).catch(
    (err) => {
      console.error("[generateLesson] pipeline error:", err);
    },
  );

  res.status(202).json({
    success: true,
    message: `Lesson video generation started for ${language}`,
    data: { video: await Video.findById(video._id).lean() },
  });
});

export const streamVideoEvents = async (req, res) => {
  const video = await Video.findById(req.params.id).lean();
  if (!video) return res.status(404).end();
  if (
    video.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    return res.status(403).end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload) => {
    if (!payload || payload.videoId !== req.params.id) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Send initial snapshot.
  res.write(
    `data: ${JSON.stringify({
      type: "video:progress",
      videoId: req.params.id,
      status: video.status,
      currentStage: video.currentStage,
      progress: video.progress,
      lastError: video.lastError,
      dubbing: video.dubbing,
      lessonGeneration: video.lessonGeneration,
      dubs: video.dubs,
      lessonVideos: video.lessonVideos,
    })}\n\n`,
  );

  const unsubscribe = subscribeProgress(`video:${req.params.id}`, send);

  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
};

export const streamGlobalEvents = async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(
    `data: ${JSON.stringify({ type: "connected", userId: req.user._id })}\n\n`,
  );

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const unsubscribe = subscribeProgress(`user:${req.user._id}`, send);

  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
};

export const streamLessonSubtitle = async (req, res) => {
  const video = await Video.findById(req.params.id).lean();
  if (!video) return res.status(404).end();
  if (
    video.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    return res.status(403).end();
  }

  const lesson =
    (video.lessonVideos || []).find(
      (item) => item.language === req.params.language && (item.source || "lesson") === "lesson",
    ) ||
    (video.lessonVideos || []).find((item) => item.language === req.params.language);
  if (!lesson) return res.status(404).end();

  let vtt = "";
  if (lesson.subtitlesUrl) {
    try {
      const upstream = await fetch(lesson.subtitlesUrl);
      if (upstream.ok) vtt = await upstream.text();
    } catch {
      // fall through to local segment data
    }
  }

  if (!vtt) {
    const format = (value) => {
      const total = Math.max(0, value || 0);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = Math.floor(total % 60);
      const millis = Math.floor((total - Math.floor(total)) * 1000);
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
    };
    const segments = lesson.segments || [];
    vtt = "WEBVTT\n\n";
    segments.forEach((segment, index) => {
      if (!segment?.text) return;
      const start = format(segment.start);
      const end = format(Math.max(segment.end, segment.start + 0.25));
      vtt += `${index + 1}\n${start} --> ${end}\n${segment.text}\n\n`;
    });
  }

  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).send(vtt);
};

export const listElevenLabsVoices = asyncHandler(async (req, res) => {
  if (!env.elevenLabsApiKey) {
    return res.status(200).json({ success: true, data: { voices: [] } });
  }
  try {
    const client = new ElevenLabsClient({ apiKey: env.elevenLabsApiKey });

    // Determine the account tier so we only suggest voices the current user
    // is actually allowed to use (e.g. exclude creator-tier voices for free).
    let tier = null;
    try {
      const user = await client.user.get();
      tier = user?.subscription?.tier || null;
    } catch {
      tier = null;
    }

    const result = await client.voices.getAll();
    const voices = (result.voices || [])
      .filter((v) => {
        const allowed = v.available_for_tiers || [];
        if (!allowed.length) return true; // available for all tiers
        if (tier && allowed.includes(tier)) return true;
        return false;
      })
      .map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        available_for_tiers: v.available_for_tiers || [],
      }));
    return res.status(200).json({ success: true, data: { voices } });
  } catch (error) {
    return res
      .status(200)
      .json({ success: true, data: { voices: [], error: error?.message } });
  }
});

export const listYouTubePlaylists = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("+youtube.accessToken +youtube.refreshToken");
  const accessToken = await getValidYouTubeAccessToken(user);
  const playlists = await fetchYouTubePlaylists(accessToken);
  res.status(200).json({ success: true, data: { playlists } });
});

export const publishLessonVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    const err = new Error("Not authorized to publish this video");
    err.statusCode = 403;
    throw err;
  }

  const language = String(req.params.language || "").trim();
  const requestedVoice = String(req.body?.voice || "").trim();

  const languageDubs = (video.dubs || []).filter((item) => item.language === language && item.url);
  const dub =
    (requestedVoice
      ? languageDubs.find((item) => String(item.voice || "") === requestedVoice)
      : null) ||
    languageDubs[0] ||
    null;
  const lessonEntry =
    (video.lessonVideos || []).find(
      (item) => item.language === language && (item.source || "lesson") === "lesson" && item.url,
    ) || null;

  const requestedSource = String(req.body?.source || "").trim();
  const publishedRecord = (video.lessonVideos || []).find(
    (item) => item.language === language && item.youtubeVideoId,
  );
  const source =
    requestedSource === "dub" || requestedSource === "lesson"
      ? requestedSource
      : publishedRecord?.source === "dub" || publishedRecord?.source === "lesson"
        ? publishedRecord.source
        : dub
          ? "dub"
          : lessonEntry
            ? "lesson"
            : null;

  if (!source) {
    const err = new Error(
      "Nothing to publish for this language yet. Dub the original video or generate a study-journey lesson first.",
    );
    err.statusCode = 400;
    throw err;
  }
  if (source === "dub" && !dub) {
    const err = new Error("No dubbed video found for this language. Dub the original video first.");
    err.statusCode = 404;
    throw err;
  }
  if (source === "lesson" && !lessonEntry) {
    const err = new Error("Generated lesson video not found for this language");
    err.statusCode = 404;
    throw err;
  }

  const mediaUrl = source === "dub" ? dub.url : lessonEntry.url;
  const mediaDuration = source === "dub" ? Number(dub.durationSeconds || 0) : Number(lessonEntry.durationSeconds || 0);
  const translation = (video.translations || []).find((item) => item.language === language);

  // Each (language, source) pair keeps its own publish record so publishing the
  // dub does not overwrite the study-journey entry.
  let lesson = (video.lessonVideos || []).find(
    (item) =>
      item.language === language &&
      (item.source || "lesson") === source &&
      (source !== "dub" || String(item.voice || "") === String(dub?.voice || "")),
  );

  if (!lesson) {
    lesson = {
      language,
      source,
      url: mediaUrl,
      storagePath: source === "dub" ? dub.storagePath || null : lessonEntry.storagePath || null,
      durationSeconds: mediaDuration,
      voice: source === "dub" ? dub.voice || null : lessonEntry.voice || null,
      script: translation?.transcript || "",
      segments: translation?.segments || [],
      subtitlesUrl: null,
      createdAt: new Date(),
    };
    video.lessonVideos = [...(video.lessonVideos || []), lesson];
  } else {
    lesson.source = source;
    lesson.url = mediaUrl;
    lesson.durationSeconds = mediaDuration;
    if (!lesson.segments?.length && translation?.segments?.length) {
      lesson.segments = translation.segments;
    }
    if (!lesson.script && translation?.transcript) {
      lesson.script = translation.transcript;
    }
  }

  const user = await User.findById(req.user._id).select("+youtube.accessToken +youtube.refreshToken");
  const accessToken = await getValidYouTubeAccessToken(user);

  const title = String(req.body?.title || (lesson.youtubeTitle || `${video.title} (${language})`)).trim();
  const description = String(req.body?.description || lesson.youtubeDescription || video.aiMetadata?.summary || video.description || "").trim();
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags
    : (lesson.youtubeTags?.length ? lesson.youtubeTags : (video.aiMetadata?.tags || []));
  const categoryId = String(req.body?.categoryId || lesson.youtubeCategoryId || video.youtubeCategoryId || "27");
  const visibility = String(req.body?.visibility || lesson.youtubeVisibility || video.youtubeVisibility || "private");
  const playlistId = req.body?.playlistId ? String(req.body.playlistId).trim() : (lesson.youtubePlaylistId || null);
  const channelId = req.body?.channelId ? String(req.body.channelId).trim() : (lesson.youtubeChannelId || null);

  const channelRes = await youtubeFetch(accessToken, `${YOUTUBE_API_URL}/channels?part=snippet&mine=true&maxResults=50`);
  const channels = channelRes.items || [];
  const channel =
    (channelId ? channels.find((c) => c.id === channelId) : null) ||
    channels[0] ||
    null;

  const thumbnailUrl = req.body?.thumbnailUrl
    ? String(req.body.thumbnailUrl).trim()
    : (lesson.thumbnailUrl || video.thumbnailUrl || "");

  const isUpdate = Boolean(lesson.youtubeVideoId);
  let youtubeVideoId = lesson.youtubeVideoId;

  if (!isUpdate) {
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
      const err = new Error(`Failed to download the ${source} video for upload (${mediaRes.status})`);
      err.statusCode = 502;
      throw err;
    }
    const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
    const uploaded = await publishYouTubeVideo(
      accessToken,
      {
        title,
        description,
        tags,
        categoryId,
        visibility,
        mimeType: "video/mp4",
      },
      mediaBuffer,
    );
    youtubeVideoId = uploaded.id;
  } else {
    await updateYouTubeVideo(accessToken, youtubeVideoId, {
      title,
      description,
      tags,
      categoryId,
      visibility,
    });
  }

  if (playlistId && playlistId !== (lesson.youtubePlaylistId || null)) {
    if (lesson.youtubePlaylistItemId) {
      try { await deletePlaylistItem(accessToken, lesson.youtubePlaylistItemId); } catch (e) {
        console.warn("[publishLessonVideo] playlist item removal failed:", e?.message);
      }
    }
    try {
      const added = await addVideoToPlaylist(accessToken, playlistId, youtubeVideoId);
      lesson.youtubePlaylistId = playlistId;
      lesson.youtubePlaylistItemId = added?.id || null;
    } catch (error) {
      console.warn("[publishLessonVideo] playlist add failed:", error?.message);
    }
  } else if (!playlistId && lesson.youtubePlaylistId) {
    if (lesson.youtubePlaylistItemId) {
      try { await deletePlaylistItem(accessToken, lesson.youtubePlaylistItemId); } catch (e) {
        console.warn("[publishLessonVideo] playlist item removal failed:", e?.message);
      }
    }
    lesson.youtubePlaylistId = null;
    lesson.youtubePlaylistItemId = null;
  } else {
    lesson.youtubePlaylistId = playlistId || lesson.youtubePlaylistId || null;
  }

  if (thumbnailUrl) {
    try {
      const imageRes = await fetch(thumbnailUrl);
      if (!imageRes.ok) {
        throw new Error(`Thumbnail download failed (${imageRes.status})`);
      }
      const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
      const mimeType = imageRes.headers.get("content-type") || "image/jpeg";
      await setYouTubeThumbnail(accessToken, youtubeVideoId, imageBuffer, mimeType);
      lesson.thumbnailUrl = thumbnailUrl;
    } catch (error) {
      console.warn("[publishLessonVideo] thumbnail upload failed:", error?.message);
    }
  }

  lesson.youtubeVideoId = youtubeVideoId;
  lesson.youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  lesson.youtubePublishedAt = lesson.youtubePublishedAt || new Date();
  lesson.youtubeVisibility = visibility;
  lesson.youtubeCategoryId = categoryId;
  lesson.youtubeTitle = title;
  lesson.youtubeDescription = description;
  lesson.youtubeTags = tags;
  lesson.youtubeChannelId = channel?.id || lesson.youtubeChannelId;
  lesson.youtubeChannelTitle = channel?.snippet?.title || lesson.youtubeChannelTitle;
  await video.save();

  res.status(200).json({
    success: true,
    message: isUpdate
      ? `Updated ${source === "dub" ? "dubbed video" : "lesson"} (${language}) on YouTube`
      : `Published ${source === "dub" ? "dubbed video" : "lesson"} (${language}) to YouTube`,
    data: {
      mode: isUpdate ? "updated" : "published",
      source,
      youtubeVideoId,
      youtubeUrl: lesson.youtubeUrl,
      channelTitle: lesson.youtubeChannelTitle,
      playlistId: lesson.youtubePlaylistId,
    },
  });
});

export const listYouTubeComments = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("+youtube.accessToken +youtube.refreshToken");
  const accessToken = await getValidYouTubeAccessToken(user);
  const comments = await fetchYouTubeComments(accessToken, req.params.youtubeVideoId);
  res.status(200).json({ success: true, data: { comments } });
});

export const replyYouTubeComment = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) {
    const err = new Error("Reply text is required");
    err.statusCode = 400;
    throw err;
  }
  const user = await User.findById(req.user._id).select("+youtube.accessToken +youtube.refreshToken");
  const accessToken = await getValidYouTubeAccessToken(user);
  const result = await replyToYouTubeComment(accessToken, req.params.commentId, text);
  res.status(200).json({ success: true, data: { comment: result } });
});

export const resumeStuckVideoPipelines = async () => {
  try {
    // Re-queue videos left in "processing" by a previous server instance/crash.
    // runPipeline is idempotent enough for this: it restarts from transcription.
    const stuck = await Video.find({ status: "processing" }).select("_id").lean();
    if (stuck.length === 0) return;
    (async () => {
      for (const item of stuck) {
        console.log(`[startup] resuming processing for video ${item._id}`);
        try {
          await runPipeline(String(item._id));
        } catch (err) {
          console.error("[startup] resume pipeline error:", err?.message || err);
        }
      }
    })();
  } catch (error) {
    console.error("[startup] failed to resume stuck videos:", error?.message || error);
  }
};

export const uploadCanvasThumbnail = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (!isOwnerOrAdmin(video, req.user)) {
    const err = new Error("Not authorized to update this video");
    err.statusCode = 403;
    throw err;
  }

  const dataUrl = String(req.body?.thumbnailDataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) {
    const err = new Error("A valid image data URL is required");
    err.statusCode = 400;
    throw err;
  }

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: `${env.cloudinaryFolder}/thumbnails`,
    resource_type: "image",
  });

  video.thumbnailUrl = result.secure_url;
  await video.save();
  emitVideoProgress(video);

  res.status(200).json({
    success: true,
    message: "Thumbnail uploaded",
    data: { thumbnailUrl: result.secure_url },
  });
});

export const getPublishPrefill = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (!isOwnerOrAdmin(video, req.user)) {
    const err = new Error("Not authorized to view this video");
    err.statusCode = 403;
    throw err;
  }

  const language = String(req.query.language || "en").trim() || "en";
  const originalLanguage =
    video.transcriptLanguage || video.originalLanguage || "en";
  const isOriginal = language.toLowerCase().startsWith(originalLanguage.toLowerCase());

  let metadata = video.aiMetadata ? video.aiMetadata.toObject() : {};
  const localized = video.aiMetadata?.localized || {};
  const cacheKey = language.toLowerCase();

  if (isOriginal) {
    // no translation needed
  } else if (localized[cacheKey]) {
    metadata = { ...metadata, ...localized[cacheKey] };
  } else {
    metadata = await translatePublishMetadata({
      metadata,
      targetLanguage: language,
      originalLanguage,
    });
    if (!video.aiMetadata) video.aiMetadata = {};
    if (!video.aiMetadata.localized) video.aiMetadata.localized = {};
    video.aiMetadata.localized[cacheKey] = {
      titles: metadata.titles,
      descriptions: metadata.descriptions,
      summary: metadata.summary,
      chapters: metadata.chapters,
      keyPoints: metadata.keyPoints,
      openQuestions: metadata.openQuestions,
      tags: metadata.tags,
    };
    video.markModified("aiMetadata");
    await video.save();
  }

  const v = await Video.findById(video._id).lean();
  res.status(200).json({
    success: true,
    data: {
      video: v,
      metadata,
      language,
    },
  });
});

export const cancelLessonGeneration = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    const err = new Error("Not authorized");
    err.statusCode = 403;
    throw err;
  }

  video.lessonGeneration = {
    ...(video.lessonGeneration?.toObject?.() || video.lessonGeneration || {}),
    status: "failed",
    progress: video.lessonGeneration?.progress || 0,
    error: "Cancelled by user",
    completedAt: new Date(),
  };
  await video.save();
  emitVideoProgress(video);

  res.status(200).json({
    success: true,
    message: "Lesson generation cancelled",
    data: { video: await Video.findById(video._id).lean() },
  });
});

export const listEdgeVoices = asyncHandler(async (req, res) => {
  const language = String(req.query.language || "").trim();
  const codes = language ? [language] : Object.keys(EDGE_VOICE_OPTIONS);
  const data = {};
  for (const code of codes) {
    data[code] = EDGE_VOICE_OPTIONS[code] || [VOICES[code] || "en-US-AriaNeural"];
  }
  res.status(200).json({
    success: true,
    message: "Edge voices",
    data: { voices: data, language: language || null },
  });
});

export const listYouTubeChannels = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("+youtube.accessToken +youtube.refreshToken");
  const accessToken = await getValidYouTubeAccessToken(user);
  const channelsRes = await youtubeFetch(
    accessToken,
    `${YOUTUBE_API_URL}/channels?part=snippet&mine=true&maxResults=50`,
  );
  const channels = (channelsRes.items || []).map((item) => ({
    id: item.id,
    title: item.snippet?.title || item.id,
    thumbnailUrl: item.snippet?.thumbnails?.default?.url || null,
  }));
  res.status(200).json({ success: true, message: "YouTube channels", data: { channels } });
});

export const cancelDubbing = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    const err = new Error("Not authorized");
    err.statusCode = 403;
    throw err;
  }
  video.dubbing = {
    ...(video.dubbing?.toObject?.() || video.dubbing || {}),
    status: "failed",
    progress: video.dubbing?.progress || 0,
    error: "Cancelled by user",
    completedAt: new Date(),
  };
  await video.save();
  emitVideoProgress(video);
  res.status(200).json({ success: true, message: "Dubbing cancelled", data: { video: await Video.findById(video._id).lean() } });
});

export const deleteDub = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    const err = new Error("Not authorized to delete this dub");
    err.statusCode = 403;
    throw err;
  }

  const language = String(req.query.language || req.body?.language || "").trim();
  const voice = String(req.query.voice || req.body?.voice || "").trim();
  if (!language) {
    const err = new Error("language is required");
    err.statusCode = 400;
    throw err;
  }

  const target = (video.dubs || []).find(
    (d) =>
      d.language === language &&
      (voice ? String(d.voice || "") === voice : true),
  );
  if (!target) {
    const err = new Error("Dub not found for this language/voice");
    err.statusCode = 404;
    throw err;
  }

  // Remove the matching publish record so the dashboard does not keep a dead link.
  video.lessonVideos = (video.lessonVideos || []).filter(
    (item) =>
      !(
        item.language === language &&
        (item.source || "lesson") === "dub" &&
        String(item.voice || "") === String(target.voice || "")
      ),
  );
  video.dubs = (video.dubs || []).filter((d) => d !== target && !(d.language === target.language && String(d.voice || "") === String(target.voice || "")));

  await video.save();

  if (target.storagePath) {
    try {
      await cloudinary.uploader.destroy(target.storagePath, { resource_type: "video" });
    } catch (error) {
      console.warn("[deleteDub] Cloudinary delete failed:", error?.message);
    }
  }

  emitVideoProgress(video);
  res.status(200).json({
    success: true,
    message: "Dubbed video deleted",
    data: { video: await Video.findById(video._id).lean() },
  });
});

export const cancelProcessing = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (video.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    const err = new Error("Not authorized to cancel processing");
    err.statusCode = 403;
    throw err;
  }
  if (video.status !== "processing") {
    return res.status(200).json({
      success: true,
      message: "Video is not currently processing",
      data: { video: await Video.findById(video._id).lean() },
    });
  }

  video.status = "failed";
  video.currentStage = "failed";
  video.lastError = {
    message: "Cancelled by user",
    stage: video.currentStage === "failed" ? "unknown" : (video.currentStage || "processing"),
    occurredAt: new Date(),
  };
  await video.save();
  emitVideoProgress(video);

  res.status(200).json({
    success: true,
    message: "Processing cancelled",
    data: { video: await Video.findById(video._id).lean() },
  });
});

export const getProcessingLabel = (stage) =>
  STAGE_LABELS[stage] || stage || "Processing";

export const translateVideo = asyncHandler(async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) {
    const err = new Error("Video not found");
    err.statusCode = 404;
    throw err;
  }
  if (!isOwnerOrAdminVideo(video, req.user)) {
    const err = new Error("Not authorized to translate this video");
    err.statusCode = 403;
    throw err;
  }

  const language = String(
    req.body?.language ||
      video.targetLanguages?.[0] ||
      video.transcriptLanguage ||
      "en",
  ).trim();
  if (!language) {
    const err = new Error("Target language is required");
    err.statusCode = 400;
    throw err;
  }

  if (
    !Array.isArray(video.transcriptSegments) ||
    video.transcriptSegments.length === 0
  ) {
    const err = new Error("Process the video first to generate a transcript");
    err.statusCode = 400;
    throw err;
  }

  video.lessonGeneration = video.lessonGeneration || {};
  // Reuse dubbing state to report translation progress.
  video.dubbing = video.dubbing || {
    language,
    status: "processing",
    progress: 5,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };

  const segments = await translateTranscriptSegments({
    segments: video.transcriptSegments,
    targetLanguage: language,
    originalLanguage:
      video.transcriptLanguage || video.originalLanguage || "en",
  });

  if (video.durationSeconds > 0 && segments.length > 0) {
    const last = segments[segments.length - 1];
    last.end = Math.max(Number(last.end) || 0, video.durationSeconds);
  }

  const qualityScores = segments
    .map((s) => s.qualityScore)
    .filter((n) => typeof n === "number");
  const avgQuality =
    qualityScores.length > 0
      ? qualityScores.reduce((sum, n) => sum + n, 0) / qualityScores.length
      : null;

  const translation = {
    language,
    transcript: segments.map((s) => s.text).join(" "),
    segments,
    qualityScore: avgQuality,
    qualityStatus:
      qualityScores.length === 0
        ? "unknown"
        : segments.every((s) => s.qualityStatus !== "failed")
        ? "passed"
        : "failed",
    translationAttempts: Math.max(
      1,
      ...segments.map((s) => s.translationAttempts || 1),
    ),
  };

  const existing = (video.translations || []).filter(
    (t) => t.language !== language,
  );
  video.translations = [...existing, translation];

  if (!video.targetLanguages) video.targetLanguages = [];
  if (!video.targetLanguages.includes(language)) {
    video.targetLanguages.push(language);
  }

  await video.save();
  emitVideoProgress(video);

  res.status(200).json({
    success: true,
    message: `Transcript translated to ${language}`,
    data: { video: await Video.findById(video._id).lean() },
  });
});
