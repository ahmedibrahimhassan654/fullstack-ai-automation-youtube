import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_youtube_automation');
const vid = new mongoose.Types.ObjectId('6b0a87db51dff47dc3dee202');
const course = await mongoose.connection.db.collection('courses').findOne(
  { 'videos.video': vid },
  { projection: { title:1, language:1, playlistId:1, playlistTitle:1, youtubePlaylistId:1, videos:1 } }
);
if(!course){ console.log('no course'); process.exit(0); }
console.log('COURSE', course.title, course.language, course.playlistTitle, course.youtubePlaylistId||course.playlistId);
const vids = (course.videos||[]).sort((a,b)=>(a.order??0)-(b.order??0));
const idx = vids.findIndex(x=>String(x.video)===String(vid));
console.log('IDX', idx, 'OF', vids.length);
for(let i=Math.max(0,idx-1); i<=Math.min(vids.length-1,idx+2); i++){
  const vdoc = await mongoose.connection.db.collection('videos').findOne({_id: vids[i].video}, {projection:{title:1}});
  console.log(i, vids[i].order, vdoc?.title);
}
await mongoose.disconnect();
