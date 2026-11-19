import jwt from 'jsonwebtoken';
import { ConfigService } from './config';

/** Same sign/verify contract as @nestjs/jwt's JwtService (HS256, JWT_SECRET, JWT_EXPIRES_IN default 7d). */
export class JwtService {
  constructor(private readonly config: ConfigService) {}

  private get secret() {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  async signAsync(payload: object, opts: { expiresIn?: string | number } = {}): Promise<string> {
    const expiresIn = (opts.expiresIn ?? this.config.get<string>('JWT_EXPIRES_IN') ?? '7d') as jwt.SignOptions['expiresIn'];
    return jwt.sign(payload, this.secret, { expiresIn });
  }

  async verifyAsync<T extends object>(token: string): Promise<T> {
    return jwt.verify(token, this.secret) as T;
  }
}
