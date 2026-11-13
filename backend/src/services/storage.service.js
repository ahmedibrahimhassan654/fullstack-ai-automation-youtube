import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveUploadsRoot = () => {
  const configured = String(env.uploadsDir || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '../../uploads');
};

export const UPLOADS_ROOT = resolveUploadsRoot();

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

export const ensureUploadsDirs = () => {
  for (const sub of ['videos', 'dubs', 'lessons', 'subtitles', 'attachments', 'thumbnails', 'courses']) {
    ensureDir(path.join(UPLOADS_ROOT, sub));
  }
};

const safeName = (name = 'file') => {
  // Keep readable lesson names (including Unicode/Arabic and spaces) but strip
  // characters that are unsafe on Windows filesystems and path separators.
  let s = String(name || 'file')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) s = 'file';
  return s.slice(0, 180);
};

const extFrom = (originalName, mimeType, fallback = '') => {
  const fromName = path.extname(originalName || '').toLowerCase();
  if (fromName) return fromName;
  const map = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/pdf': '.pdf',
    'text/vtt': '.vtt',
    'application/x-subrip': '.srt',
    'text/plain': '.txt',
  };
  return map[mimeType] || fallback;
};

export const isLocalStorage = (videoOrProvider) => {
  if (!videoOrProvider) return false;
  if (typeof videoOrProvider === 'string') return videoOrProvider === 'local';
  return (
    videoOrProvider.storageProvider === 'local' ||
    String(videoOrProvider.storagePath || '').startsWith('local:') ||
    String(videoOrProvider.publicUrl || '').includes('/uploads/')
  );
};

export const getLocalFilePath = (storagePath) => {
  if (!storagePath) return null;
  const rel = String(storagePath).startsWith('local:')
    ? String(storagePath).slice('local:'.length)
    : String(storagePath);
  // Prevent path traversal.
  const full = path.resolve(UPLOADS_ROOT, rel);
  if (!full.startsWith(UPLOADS_ROOT)) return null;
  return full;
};

const serverBaseUrl = () =>
  (env.serverUrl || `http://localhost:${env.port || 5000}`).replace(/\/+$/, '');

export const localPublicUrl = (relativePath) => {
  const rel = String(relativePath).replace(/^\/+/, '').replace(/\\/g, '/');
  const encoded = rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `${serverBaseUrl()}/uploads/${encoded}`;
};

export const saveBufferLocally = async ({ buffer, subdir, originalName, mimeType, ext, desiredName, keepName = false }) => {
  ensureUploadsDirs();
  const dir = path.join(UPLOADS_ROOT, subdir);
  ensureDir(dir);
  const extension = ext || extFrom(originalName, mimeType, extFrom(desiredName, mimeType, ''));
  const sourceName = desiredName || originalName || 'file';
  const base = safeName(path.basename(sourceName, path.extname(sourceName)));
  let filename;
  if (keepName) {
    filename = `${base}${extension}`;
    let candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      let i = 2;
      while (fs.existsSync(candidate)) {
        filename = `${base}-${i}${extension}`;
        candidate = path.join(dir, filename);
        i += 1;
      }
    }
  } else {
    filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${extension}`;
  }
  const relativePath = path.posix.join(subdir, filename);
  const fullPath = path.join(dir, filename);
  await fs.promises.writeFile(fullPath, buffer);
  return {
    provider: 'local',
    url: localPublicUrl(relativePath),
    storagePath: `local:${relativePath}`,
    relativePath,
    fullPath,
    bytes: buffer?.length || 0,
  };
};

export const saveFileLocally = async ({ filePath, subdir, originalName, mimeType, ext }) => {
  const buffer = await fs.promises.readFile(filePath);
  return saveBufferLocally({ buffer, subdir, originalName: originalName || path.basename(filePath), mimeType, ext });
};

const isCloudinaryLimitError = (error) => {
  const msg = String(error?.message || '');
  const code = error?.http_code || error?.statusCode;
  return (
    code === 413 ||
    code === 420 ||
    /413/.test(msg) ||
    /too large/i.test(msg) ||
    /limit/i.test(msg) && /storage|quota|upload|bandwidth|credit/i.test(msg) ||
    /quota/i.test(msg) ||
    /exceeded/i.test(msg) ||
    /maximum/i.test(msg) && /size|storage|file/i.test(msg)
  );
};

const uploadBufferToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'video', ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(buffer);
  });

export const storeBuffer = async ({ buffer, subdir = 'videos', originalName, mimeType, cloudinaryOptions = {}, preferLocal = false, desiredName, keepName = false }) => {
  const canCloudinary = isCloudinaryConfigured();
  if (!preferLocal && env.storageProvider !== 'local' && canCloudinary) {
    try {
      const opts = { ...cloudinaryOptions };
      if (keepName && desiredName) {
        opts.public_id = safeName(path.basename(desiredName, path.extname(desiredName)));
        opts.use_filename = false;
        opts.unique_filename = false;
      }
      const result = await uploadBufferToCloudinary(buffer, opts);
      return {
        provider: 'cloudinary',
        url: result.secure_url,
        storagePath: result.public_id,
        duration: result.duration || 0,
        eager: result.eager || null,
        raw: result,
      };
    } catch (error) {
      if (!isCloudinaryLimitError(error)) throw error;
      // Fall through to local storage when Cloudinary rejects due to limits.
      console.warn('[storage] Cloudinary limit hit, saving locally:', error?.message);
    }
  }
  // Local fallback/storage.
  const local = await saveBufferLocally({ buffer, subdir, originalName, mimeType, desiredName, keepName });
  return {
    provider: 'local',
    url: local.url,
    storagePath: local.storagePath,
    duration: 0,
    eager: null,
    raw: local,
  };
};

export const storeFile = async ({ filePath, subdir = 'videos', originalName, mimeType, cloudinaryOptions = {}, preferLocal = false, desiredName, keepName = false }) => {
  const buffer = await fs.promises.readFile(filePath);
  return storeBuffer({ buffer, subdir, originalName: originalName || path.basename(filePath), mimeType, cloudinaryOptions, preferLocal, desiredName, keepName });
};

export const deleteStored = async ({ storagePath, storageProvider, resourceType = 'video', url }) => {
  const provider = storageProvider || (isLocalStorage({ storagePath, publicUrl: url }) ? 'local' : 'cloudinary');
  if (provider === 'local' || String(storagePath || '').startsWith('local:')) {
    const full = getLocalFilePath(storagePath);
    if (full && fs.existsSync(full)) {
      try { await fs.promises.unlink(full); } catch { /* ignore */ }
    }
    return;
  }
  if (storagePath && isCloudinaryConfigured()) {
    try {
      await cloudinary.uploader.destroy(storagePath, { resource_type: resourceType });
    } catch { /* ignore */ }
  }
};

export const resolveSourcePath = (video) => {
  if (!video) return null;
  if (isLocalStorage(video)) {
    const p = getLocalFilePath(video.storagePath);
    if (p && fs.existsSync(p)) return p;
  }
  return video.publicUrl || null;
};

export const readSourceBuffer = async (video) => {
  if (isLocalStorage(video)) {
    const p = getLocalFilePath(video.storagePath);
    if (!p || !fs.existsSync(p)) throw new Error('Local video file not found on disk');
    const buffer = await fs.promises.readFile(p);
    return { buffer, path: p };
  }
  return null;
};
