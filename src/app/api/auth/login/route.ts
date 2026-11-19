import { parseLogin } from '@/server/dto';
import { services } from '@/server/container';
import { readJson, route } from '@/server/http';

export const runtime = 'nodejs';

export const POST = route(async (req) => services.auth.login(parseLogin(await readJson(req))));
