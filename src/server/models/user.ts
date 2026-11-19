import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';

export interface LinkedinAccount {
  personUrn: string;
  name?: string;
  picture?: string;
  /** AES-GCM encrypted access token */
  accessToken: string;
  expiresAt: Date;
  connectedAt: Date;
}
export interface InstagramAccount {
  igUserId?: string;
  username: string;
  picture?: string;
  /** AES-GCM encrypted long-lived access token */
  accessToken: string;
  expiresAt: Date;
  connectedAt: Date;
  refreshedAt?: Date;
}
export interface FacebookPage {
  id: string;
  name: string;
  picture?: string;
  /** AES-GCM encrypted Page access token */
  accessToken: string;
}
export interface FacebookAccount {
  pages: FacebookPage[];
  selectedPageId?: string;
}
export interface User {
  name: string;
  email: string;
  passwordHash?: string;
  googleId?: string;
  avatar?: string;
  timezone: string;
  linkedin?: LinkedinAccount;
  instagram?: InstagramAccount;
  facebook?: FacebookAccount;
}

const LinkedinAccountSchema = new Schema<LinkedinAccount>(
  {
    personUrn: { type: String, required: true },
    name: String,
    picture: String,
    accessToken: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    connectedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const InstagramAccountSchema = new Schema<InstagramAccount>(
  {
    igUserId: String,
    username: { type: String, required: true },
    picture: String,
    accessToken: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    connectedAt: { type: Date, default: () => new Date() },
    refreshedAt: Date,
  },
  { _id: false },
);

const FacebookPageSchema = new Schema<FacebookPage>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    picture: String,
    accessToken: { type: String, required: true, select: false },
  },
  { _id: false },
);

const FacebookAccountSchema = new Schema<FacebookAccount>(
  {
    pages: { type: [FacebookPageSchema], default: [] },
    selectedPageId: String,
  },
  { _id: false },
);

const UserSchema = new Schema<User>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    googleId: { type: String, index: true, sparse: true },
    avatar: String,
    timezone: { type: String, default: 'UTC' },
    linkedin: LinkedinAccountSchema,
    instagram: InstagramAccountSchema,
    facebook: FacebookAccountSchema,
  },
  { timestamps: true },
);

export type UserDocument = HydratedDocument<User>;
export const UserModel: Model<User> = (mongoose.models.User as Model<User>) ?? mongoose.model<User>('User', UserSchema);
