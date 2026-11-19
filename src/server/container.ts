import { ConfigService } from './config';
import { JwtService } from './jwt';
import { PostModel } from './models/post';
import { UserModel } from './models/user';
import { AuthService } from './services/auth.service';
import { FacebookService } from './services/facebook.service';
import { InstagramService } from './services/instagram.service';
import { LinkedinService } from './services/linkedin.service';
import { PostsService } from './services/posts.service';
import { SchedulerService } from './services/scheduler.service';
import { UsersService } from './services/users.service';

function build() {
  const config = new ConfigService();
  const jwt = new JwtService(config);
  const users = new UsersService(UserModel, config);
  const linkedin = new LinkedinService(users, config, jwt);
  const instagram = new InstagramService(users, config, jwt);
  const facebook = new FacebookService(users, config, jwt);
  const auth = new AuthService(users, jwt, config);
  const posts = new PostsService(PostModel, users, linkedin, instagram, facebook, config);
  const scheduler = new SchedulerService(posts, instagram, config);
  return { config, jwt, users, linkedin, instagram, facebook, auth, posts, scheduler };
}

// one wiring per server instance (survives dev hot-reload)
const g = globalThis as unknown as { __services?: ReturnType<typeof build> };
export const services = (g.__services ??= build());
