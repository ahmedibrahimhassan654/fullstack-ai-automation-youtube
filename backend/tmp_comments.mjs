import 'dotenv/config';
import mongoose from 'mongoose';
import User from './src/models/User.js';
import { getValidYouTubeAccessToken, youtubeFetch } from './src/services/youtubePublish.service.js';

const YOUTUBE_TOKEN_FIELDS = '+youtube.accessToken +youtube.refreshToken +youtubeAccounts.accessToken +youtubeAccounts.refreshToken';

await mongoose.connect(process.env.MONGODB_URI);
const user = await User.findById('6aec47d7cc50642180aa4ae9').select(YOUTUBE_TOKEN_FIELDS);
const channelId = user.youtubeAccounts?.[0]?.channelId || user.youtube?.channelId;
const token = await getValidYouTubeAccessToken(user, channelId);

const videoId = 'hKkRBGzIUKs';
const res = await youtubeFetch(token, `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&maxResults=50&order=time`);
console.log('total comments:', (res.items||[]).length);
for (const c of res.items || []) {
  const t = c.snippet?.topLevelComment?.snippet?.textDisplay || '';
  console.log('-', t.slice(0, 120));
}
await mongoose.disconnect();
process.exit(0);
