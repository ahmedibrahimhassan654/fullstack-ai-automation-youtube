import multer from 'multer';

const MAX_SIZE_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const MAX_ATTACHMENT_MB = Number(process.env.MAX_ATTACHMENT_MB || 25);

const storage = multer.memoryStorage();

const videoFilter = (req, file, cb) => {
  const allowed = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/mpeg',
    'video/x-matroska',
  ];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  // Fallback for clients that send octet-stream for known video extensions.
  if (/\.(mp4|mov|avi|webm|mkv|mpe?g)$/i.test(file.originalname || '')) return cb(null, true);
  cb(new Error('Unsupported video file type.'));
};

const attachmentFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
    'image/png',
    'image/jpeg',
  ];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported attachment file type.'));
};

const subtitleFilter = (req, file, cb) => {
  const allowed = [
    'text/plain',
    'text/vtt',
    'application/x-subrip',
    'application/octet-stream',
  ];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  if (/\.(srt|vtt)$/i.test(file.originalname || '')) return cb(null, true);
  cb(new Error('Unsupported subtitle file type (expected .srt or .vtt).'));
};

export const uploadVideo = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: videoFilter,
}).single('video');

export const uploadVideoWithAttachments = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video') return videoFilter(req, file, cb);
    if (file.fieldname === 'attachments') return attachmentFilter(req, file, cb);
    if (['subtitle', 'subtitles', 'srt', 'srtFile', 'caption', 'captions'].includes(file.fieldname)) return subtitleFilter(req, file, cb);
    cb(new Error('Unexpected file field.'));
  },
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'attachments', maxCount: 10 },
  { name: 'subtitle', maxCount: 1 },
  { name: 'subtitles', maxCount: 5 },
  { name: 'srt', maxCount: 1 },
  { name: 'srtFile', maxCount: 1 },
  { name: 'caption', maxCount: 1 },
  { name: 'captions', maxCount: 5 },
]);
