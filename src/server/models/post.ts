import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export type Platform = 'linkedin' | 'instagram' | 'facebook';
export type PostStatus = 'scheduled' | 'publishing' | 'published' | 'failed';

export interface PostMedia {
  /** file name in storage (inside UPLOAD_DIR locally / Blob pathname); also the public path segment */
  filename: string;
  /** public URL when the file lives in object storage (Vercel Blob); absent for local-disk files */
  url?: string;
  originalName: string;
  mimetype: string;
  size: number;
  kind: 'image' | 'video';
}

export interface Post {
  userId: Types.ObjectId;
  /** which network this post goes to; posts created before Instagram support are LinkedIn */
  platform: Platform;
  /** posts composed once and sent to several networks share a group id (one document per network) */
  groupId?: string;
  content: string;
  /** exact instant (UTC) the post should go out */
  scheduledAt: Date;
  /** IANA timezone the user picked the slot in (for display / validation) */
  timezone: string;
  media: PostMedia[];
  status: PostStatus;
  attempts: number;
  lockedAt?: Date;
  /** after a transient failure, don't retry before this instant */
  retryAfter?: Date;
  lastError?: string;
  linkedinPostUrn?: string;
  /** id of the published post on the remote network (Instagram media id) */
  remoteId?: string;
  permalink?: string;
  publishedAt?: Date;
}

const PostMediaSchema = new Schema<PostMedia>(
  {
    filename: { type: String, required: true },
    url: String,
    originalName: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    kind: { type: String, required: true, enum: ['image', 'video'] },
  },
  { _id: false },
);

const PostSchema = new Schema<Post>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, default: 'linkedin', enum: ['linkedin', 'instagram', 'facebook'] },
    groupId: { type: String, index: true },
    content: { type: String, required: true, maxlength: 63206 },
    scheduledAt: { type: Date, required: true },
    timezone: { type: String, default: 'UTC' },
    media: { type: [PostMediaSchema], default: [] },
    status: { type: String, default: 'scheduled', enum: ['scheduled', 'publishing', 'published', 'failed'] },
    attempts: { type: Number, default: 0 },
    lockedAt: Date,
    retryAfter: Date,
    lastError: String,
    linkedinPostUrn: String,
    remoteId: String,
    permalink: String,
    publishedAt: Date,
  },
  { timestamps: true },
);
// one post per user per platform per slot; also serves the scheduler's due-query
PostSchema.index({ userId: 1, platform: 1, scheduledAt: 1 }, { unique: true });
PostSchema.index({ userId: 1, groupId: 1 });
PostSchema.index({ status: 1, scheduledAt: 1 });

export type PostDocument = HydratedDocument<Post>;
export const PostModel: Model<Post> = (mongoose.models.Post as Model<Post>) ?? mongoose.model<Post>('Post', PostSchema);
