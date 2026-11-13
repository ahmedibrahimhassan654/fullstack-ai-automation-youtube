import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Video from '../src/models/Video.js';
import { getLocalFilePath, localPublicUrl } from '../src/services/storage.service.js';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const v = await Video.findById('6af710b5fdfbc1ed848d3e9a');
  if (!v) {
    console.log('not found');
    process.exit(0);
  }
  const newTitle = '13. Install Anonsurf and start using it!';
  const oldPath = getLocalFilePath(v.storagePath);
  console.log('old', {
    title: v.title,
    originalFilename: v.originalFilename,
    storagePath: v.storagePath,
    publicUrl: v.publicUrl,
    oldPath,
    exists: oldPath ? fs.existsSync(oldPath) : false,
  });
  if (oldPath && fs.existsSync(oldPath)) {
    const ext = path.extname(oldPath) || '.mp4';
    const dir = path.dirname(oldPath);
    let base = newTitle.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
    let filename = base + ext;
    let full = path.join(dir, filename);
    let i = 2;
    while (fs.existsSync(full) && full.toLowerCase() !== oldPath.toLowerCase()) {
      filename = `${base}-${i}${ext}`;
      full = path.join(dir, filename);
      i += 1;
    }
    if (full.toLowerCase() !== oldPath.toLowerCase()) {
      fs.renameSync(oldPath, full);
    }
    const rel = path.posix.join('videos', filename);
    v.storagePath = `local:${rel}`;
    v.publicUrl = localPublicUrl(rel);
    v.originalFilename = filename;
  }
  v.title = newTitle;
  await v.save();
  console.log('new', {
    title: v.title,
    originalFilename: v.originalFilename,
    storagePath: v.storagePath,
    publicUrl: v.publicUrl,
  });
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
