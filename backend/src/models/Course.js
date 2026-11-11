import mongoose from 'mongoose';

export const COURSE_STATUSES = ['draft', 'published'];

const courseVideoSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
    },
    order: { type: Number, default: 0 },
    addedAt: { type: Date, default: Date.now },
    // The language of the lesson inside this course.
    language: { type: String, default: null },
    // The YouTube video the lesson was published as.
    youtubeVideoId: { type: String, default: null },
    youtubeUrl: { type: String, default: null },
    youtubePlaylistItemId: { type: String, default: null },
    publishedAt: { type: Date, default: null },
  },
  { _id: false }
);

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Course title is required'],
      trim: true,
      maxlength: 200,
    },
    description: { type: String, default: '', maxlength: 5000 },
    // The language the course is taught in. It decides the default language
    // of the videos inside it.
    language: { type: String, default: 'en' },
    // The YouTube channel the course is published to. The channel carries a
    // language, so the course language follows it.
    channelId: { type: String, default: null },
    channelTitle: { type: String, default: null },
    // The language the channel publishes in, remembered with the course.
    channelLanguage: { type: String, default: null },
    // The playlist on that channel holding the lessons.
    playlistId: { type: String, default: null },
    playlistTitle: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
      index: true,
    },
    // The lessons of the course, in playing order.
    videos: { type: [courseVideoSchema], default: [] },
    status: {
      type: String,
      enum: COURSE_STATUSES,
      default: 'draft',
    },
    // Progress of the publish run.
    publishing: {
      status: {
        type: String,
        enum: ['idle', 'processing', 'completed', 'failed'],
        default: 'idle',
      },
      progress: { type: Number, default: 0 },
      publishedCount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      error: { type: String, default: null },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
    },
    // The YouTube playlist the course was published as.
    youtubePlaylistId: { type: String, default: null },
    youtubePlaylistUrl: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

courseSchema.index({ owner: 1, createdAt: -1 });

export default mongoose.model('Course', courseSchema);
