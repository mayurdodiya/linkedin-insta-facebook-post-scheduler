import { requireUser } from '@/server/auth-guard';
import { services } from '@/server/container';
import { parseUpdateProfile } from '@/server/dto';
import { NotFoundException, readJson, route } from '@/server/http';
import { isValidTimezone } from '@/server/services/auth.service';

export const runtime = 'nodejs';

export const GET = route(async (req) => {
  const u = await requireUser(req);
  const user = await services.users.findById(u.id);
  if (!user) throw new NotFoundException('User not found');
  return services.users.toPublic(user);
});

export const PATCH = route(async (req) => {
  const u = await requireUser(req);
  const dto = parseUpdateProfile(await readJson(req));
  const patch: { name?: string; timezone?: string } = {};
  if (dto.name) patch.name = dto.name.trim();
  if (isValidTimezone(dto.timezone)) patch.timezone = dto.timezone;
  const user = await services.users.updateProfile(u.id, patch);
  if (!user) throw new NotFoundException('User not found');
  return services.users.toPublic(user);
});
