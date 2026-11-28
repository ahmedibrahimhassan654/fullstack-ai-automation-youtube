import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_youtube_automation');
const id = '6b0a87db51dff47dc3dee202';
const v = await mongoose.connection.db.collection('videos').findOne(
  { _id: new mongoose.Types.ObjectId(id) },
  { projection: { title:1, originalFilename:1, transcript:1, transcriptSegments:1, transcriptLanguage:1, originalLanguage:1, aiMetadata:1, translations:1, lessonVideos:1, dubs:1, durationSeconds:1, youtubeCategoryId:1, youtubeVisibility:1, thumbnailUrl:1 } }
);
if (!v) { console.log('not found'); process.exit(0); }
console.log('TITLE', v.title);
console.log('FILE', v.originalFilename);
console.log('LANG', v.originalLanguage, v.transcriptLanguage, 'DUR', v.durationSeconds);
console.log('TRANSCRIPT_LEN', (v.transcript||'').length);
console.log('SEGS', (v.transcriptSegments||[]).length);
console.log('AI_META', JSON.stringify(v.aiMetadata||null).slice(0,4000));
console.log('TRANSCRIPT_START', (v.transcript||'').slice(0,2500));
const ar = (v.translations||[]).find(t=>String(t.language).toLowerCase()==='ar');
console.log('AR_TRANSLATION', !!ar, ar?.segments?.length);
console.log('AR_TEXT_START', String(ar?.transcript||'').slice(0,1500));
await mongoose.disconnect();
