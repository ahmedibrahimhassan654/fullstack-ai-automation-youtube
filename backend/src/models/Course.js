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
