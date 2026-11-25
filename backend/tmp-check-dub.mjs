import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_youtube_automation');
const v = await mongoose.connection.db.collection('videos').findOne(
  { _id: new mongoose.Types.ObjectId('6af90c753aa5095f14858af7') },
  { projection: { transcriptSegments: 1, translations: 1, dubbing: 1, title: 1, originalLanguage: 1, transcriptLanguage: 1 } }
);
if (!v) { console.log('not found'); process.exit(0); }
console.log('title', v.title);
console.log('orig', v.originalLanguage, 'trans', v.transcriptLanguage);
console.log('segs', v.transcriptSegments?.length);
const ar = (v.translations || []).find(t => String(t.language).toLowerCase() === 'ar');
console.log('ar segs', ar?.segments?.length);
if (ar?.segments) {
  const bad = [];
  ar.segments.forEach((s, i) => {
    const txt = String(s?.text || '').trim();
    const hasAr = /[\u0600-\u06FF]/.test(txt);
    const src = String(v.transcriptSegments?.[i]?.text || '').trim();
    if (!hasAr && src) bad.push({ i, src: src.slice(0, 160), txt: txt.slice(0, 160), hasTxt: !!txt });
  });
  console.log('bad', bad.length);
  console.log(JSON.stringify(bad.slice(0, 10), null, 2));
}
console.log('dubbing err', (v.dubbing?.error || '').slice(0, 300));
await mongoose.disconnect();
