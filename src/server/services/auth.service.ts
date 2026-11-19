import bcrypt from 'bcryptjs';
import { appBaseUrl, ConfigService } from '../config';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../http';
import { JwtService } from '../jwt';
import type { UsersService } from './users.service';
import type { LoginDto, RegisterDto } from '../dto';

export function isValidTimezone(tz?: string): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private session(userId: string) {
    return this.jwt.signAsync({ sub: userId });
  }

  async register(dto: RegisterDto) {
    const existing = await this.users.findByEmailWithPassword(dto.email);
    if (existing) throw new ConflictException('An account with this email already exists');
    const user = await this.users.create({
      name: dto.name.trim(),
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, 12),
      timezone: isValidTimezone(dto.timezone) ? dto.timezone : 'UTC',
    });
    return { token: await this.session(user.id), user: this.users.toPublic(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user?.passwordHash) {
      // Google-only accounts have no password
      throw new UnauthorizedException(
        user ? 'This account uses Google sign-in' : 'Invalid email or password',
      );
    }
    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return { token: await this.session(user.id), user: this.users.toPublic(user) };
  }

  // ---- Google OAuth (authorization-code flow) ----

  private google() {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException('Google sign-in is not configured on the server');
    }
    const redirectUri = `${appBaseUrl(this.config)}/api/auth/google/callback`;
    return { clientId, clientSecret, redirectUri };
  }

  async googleAuthUrl() {
    const g = this.google();
    const state = await this.jwt.signAsync({ typ: 'google-state' }, { expiresIn: '10m' });
    const q = new URLSearchParams({
      client_id: g.clientId,
      redirect_uri: g.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  /** Returns a session token for the Google account, creating the user when needed. */
  async googleCallback(code: string, state: string) {
    const g = this.google();
    try {
      const s = await this.jwt.verifyAsync<{ typ: string }>(state);
      if (s.typ !== 'google-state') throw new Error();
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: g.clientId,
        client_secret: g.clientSecret,
        redirect_uri: g.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new BadRequestException('Google token exchange failed');
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok) throw new BadRequestException('Could not read Google profile');
    const p = (await infoRes.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!p.email || !p.email_verified) throw new BadRequestException('Google email is not verified');
    const user = await this.users.upsertGoogle({
      googleId: p.sub,
      email: p.email,
      name: p.name ?? p.email.split('@')[0],
      avatar: p.picture,
    });
    return this.session(user.id);
  }
}
