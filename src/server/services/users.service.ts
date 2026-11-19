import type { Model } from 'mongoose';
import { ConfigService } from '../config';
import { decrypt, encrypt } from '../crypto';
import type { User, UserDocument } from '../models/user';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  timezone: string;
  linkedin: null | {
    name?: string;
    picture?: string;
    expiresAt: Date;
    expired: boolean;
  };
  instagram: null | {
    username: string;
    picture?: string;
    expiresAt: Date;
    expired: boolean;
  };
  facebook: null | {
    pages: { id: string; name: string; picture?: string }[];
    selectedPageId?: string;
  };
}

export class UsersService {
  constructor(
    private readonly model: Model<User>,
    private readonly config: ConfigService,
  ) {}

  private get secret() {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  findByEmailWithPassword(email: string) {
    return this.model.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  }

  findById(id: string) {
    return this.model.findById(id);
  }

  create(data: Partial<User>) {
    return this.model.create(data);
  }

  async upsertGoogle(p: { googleId: string; email: string; name: string; avatar?: string }) {
    const email = p.email.toLowerCase();
    const user = await this.model.findOne({ $or: [{ googleId: p.googleId }, { email }] });
    if (!user) return this.model.create({ ...p, email });
    if (!user.googleId) user.googleId = p.googleId;
    if (!user.avatar && p.avatar) user.avatar = p.avatar;
    return user.save();
  }

  updateProfile(id: string, patch: { name?: string; timezone?: string }) {
    return this.model.findByIdAndUpdate(id, patch, { returnDocument: 'after' });
  }

  setLinkedin(
    id: string,
    a: { personUrn: string; name?: string; picture?: string; accessToken: string; expiresAt: Date },
  ) {
    return this.model.findByIdAndUpdate(id, {
      linkedin: { ...a, accessToken: encrypt(a.accessToken, this.secret), connectedAt: new Date() },
    });
  }

  clearLinkedin(id: string) {
    return this.model.findByIdAndUpdate(id, { $unset: { linkedin: 1 } });
  }

  setInstagram(
    id: string,
    a: { igUserId?: string; username: string; picture?: string; accessToken: string; expiresAt: Date },
  ) {
    return this.model.findByIdAndUpdate(id, {
      instagram: { ...a, accessToken: encrypt(a.accessToken, this.secret), connectedAt: new Date() },
    });
  }

  clearInstagram(id: string) {
    return this.model.findByIdAndUpdate(id, { $unset: { instagram: 1 } });
  }

  async setFacebookPages(
    id: string,
    pages: { id: string; name: string; picture?: string; accessToken: string }[],
  ) {
    const user = await this.model.findById(id);
    if (!user) return null;
    const selectedPageId = pages.some((page) => page.id === user.facebook?.selectedPageId)
      ? user.facebook?.selectedPageId
      : undefined;
    user.facebook = {
      pages: pages.map((page) => ({
        ...page,
        accessToken: encrypt(page.accessToken, this.secret),
      })),
      selectedPageId,
    };
    return user.save();
  }

  async selectFacebookPage(id: string, pageId: string) {
    const result = await this.model.updateOne(
      { _id: id, 'facebook.pages.id': pageId },
      { $set: { 'facebook.selectedPageId': pageId } },
    );
    return result.matchedCount > 0;
  }

  clearFacebook(id: string) {
    return this.model.findByIdAndUpdate(id, { $unset: { facebook: 1 } });
  }

  async getFacebookCredentials(id: string) {
    const user = await this.model.findById(id).select('+facebook.pages.accessToken');
    const selected = user?.facebook?.pages.find(
      (page) => page.id === user.facebook?.selectedPageId,
    );
    if (!selected) return null;
    return {
      pageId: selected.id,
      pageName: selected.name,
      accessToken: decrypt(selected.accessToken, this.secret),
    };
  }

  async updateInstagramToken(id: string, accessToken: string, expiresAt: Date) {
    await this.model.findByIdAndUpdate(id, {
      'instagram.accessToken': encrypt(accessToken, this.secret),
      'instagram.expiresAt': expiresAt,
      'instagram.refreshedAt': new Date(),
    });
  }

  /** Users whose Instagram token expires before the given date (and has not expired yet). */
  async findInstagramExpiringIds(before: Date): Promise<string[]> {
    const rows = await this.model
      .find({ 'instagram.expiresAt': { $gt: new Date(), $lt: before } })
      .select('_id');
    return rows.map((r) => r.id as string);
  }

  async getInstagramCredentials(id: string) {
    const u = await this.model.findById(id).select('+instagram.accessToken');
    if (!u?.instagram) return null;
    return {
      igUserId: u.instagram.igUserId,
      accessToken: decrypt(u.instagram.accessToken, this.secret),
      expiresAt: u.instagram.expiresAt,
      connectedAt: u.instagram.connectedAt,
      refreshedAt: u.instagram.refreshedAt,
    };
  }

  /** Decrypted credentials for publishing, or null when not connected. */
  async getLinkedinCredentials(id: string) {
    const u = await this.model.findById(id).select('+linkedin.accessToken');
    if (!u?.linkedin) return null;
    return {
      personUrn: u.linkedin.personUrn,
      accessToken: decrypt(u.linkedin.accessToken, this.secret),
      expiresAt: u.linkedin.expiresAt,
    };
  }

  toPublic(u: UserDocument): PublicUser {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
      timezone: u.timezone,
      linkedin: u.linkedin
        ? {
            name: u.linkedin.name,
            picture: u.linkedin.picture,
            expiresAt: u.linkedin.expiresAt,
            expired: u.linkedin.expiresAt.getTime() < Date.now(),
          }
        : null,
      instagram: u.instagram
        ? {
            username: u.instagram.username,
            picture: u.instagram.picture,
            expiresAt: u.instagram.expiresAt,
            expired: u.instagram.expiresAt.getTime() < Date.now(),
          }
        : null,
      facebook: u.facebook
        ? {
            pages: u.facebook.pages.map(({ id, name, picture }) => ({ id, name, picture })),
            selectedPageId: u.facebook.selectedPageId,
          }
        : null,
    };
  }
}
