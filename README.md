# Social Post Scheduler

Plan a whole month of social posts once; the server publishes them to LinkedIn, Instagram, and Facebook Pages for you.

**Stack:** Next.js (App Router, one project: UI + `/api` route handlers) · MongoDB (Mongoose + GridFS media fallback) · AWS S3 or Vercel Blob media storage (optional) · Vercel Cron scheduler

## Flow
1. Sign up / log in with email + password or Google OAuth.
2. Dashboard → connect LinkedIn, Instagram, and/or a Facebook Page.
3. **Plan posts** → click a day → pick a slot (9:00–19:00, hourly, in your timezone) → text + images
   (up to 9, or 10 for Facebook-only posts) or one MP4.
   Pick one network or any combination - connected networks are selected by default, so one composer can publish to all of them.
   Choose **One post per day** to upload up to 30 photos at once: each photo becomes its own post, one per consecutive day
   at the same time (10:00 by default), with an optional caption per photo. Days whose slot is already taken are skipped and
   reported in the composer.
4. The scheduler (Vercel Cron → `/api/cron/scheduler`) runs once daily at 10:00 AM India time (04:30 UTC), claims due posts atomically, and publishes through each network's API.
   Transient errors retry up to 3 times; an expired connection or a missed window (> `MISSED_GRACE_HOURS`) marks the post **failed** with the reason shown in the UI.
   Uploaded media stays in storage until publishing succeeds for every network copy; failed posts keep their media so they can be retried, and the files are then deleted from the server.

> Vercel Hobby allows one cron invocation per day. The cron runs at 10:00 AM IST and catches every post already due at that time. Local development still checks every 15 minutes.

## Project layout
```
src/app/            pages (login, dashboard, planner) + api/ route handlers (auth, posts, linkedin, instagram, facebook, cron) + uploads/ (local-disk media)
src/views, src/components, src/api.ts, src/auth.tsx, src/theme.tsx, src/style.css   the UI
src/server/         models, services (same logic as the former NestJS modules), storage, db, jwt
instrumentation.ts  runs the scheduler in-process when NOT on Vercel
backend/, frontend/ the previous NestJS + Vite apps (no longer used; safe to delete)
```

## Setup
```bash
cp .env.example .env.local   # fill MONGODB_URI, JWT_SECRET, Google + LinkedIn keys
npm install
npm run dev                  # http://localhost:3000  (UI and API under /api)
npm test                     # unit tests
```
Locally media goes to `UPLOAD_DIR` (served at `/uploads/<file>`) and the scheduler runs inside the dev/start server every 15 min.

## Deploy to Vercel (no separate backend server)
1. Import the repo in Vercel (framework: Next.js, root directory: repo root).
2. Media uploads use MongoDB GridFS by default on Vercel. To use AWS S3, set `AWS_S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`; S3 takes precedence over Blob and GridFS. Grant the IAM user `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` for `arn:aws:s3:::YOUR_BUCKET/uploads/*`. Keep the bucket private: the app streams S3 media through public `/uploads` URLs for social networks. Alternatively, configure Vercel Blob with `BLOB_READ_WRITE_TOKEN`.
3. Set the env vars from `.env.example`: `APP_URL` (your production URL), `MONGODB_URI` (e.g. MongoDB Atlas), `JWT_SECRET`, OAuth keys, and `CRON_SECRET` (any long random string - Vercel Cron sends it as a bearer token).
4. Register the redirect URIs with `{APP_URL}` as the base (see below). They are the same paths as before.
5. `vercel.json` schedules `/api/cron/scheduler` every 15 minutes. **Vercel Hobby only allows daily crons** - use Pro for the 15-minute schedule (or point any external pinger at the endpoint with the `Authorization: Bearer $CRON_SECRET` header).

Vercel limits to be aware of: a function request body is capped at ~4.5 MB, so large JPEG/PNG photos are downscaled in the browser before upload, but videos larger than that will be rejected on Vercel; the 100 MB `MAX_UPLOAD_MB` only applies to self-hosting. Publishing routes allow up to 300 s per request.

### OAuth apps
- **Google** (console.cloud.google.com → Credentials → OAuth client, Web): redirect URI `{APP_URL}/api/auth/google/callback` (locally `http://localhost:3000/...`)
- **LinkedIn** (linkedin.com/developers → create app): add products *Sign In with LinkedIn using OpenID Connect* and *Share on LinkedIn*;
  redirect URL `{APP_URL}/api/linkedin/callback`. Copy Client ID/Secret into `.env`.
  LinkedIn member tokens last ~60 days; the dashboard shows the days left and users reconnect when it expires.

For production set `APP_URL` to the public URL and register those redirect URIs (`BACKEND_URL` is still read as a fallback; `FRONTEND_URL` is no longer used).

## Integration setup cheat sheet (callback URLs & Meta config)
Callback pattern: `{APP_URL}/api/<network>/callback` - production `https://<your-app>.vercel.app`, local `http://localhost:3000`.
- URIs must match **exactly** (no trailing slash). Type them by hand; pasted URLs can carry hidden characters (red icon in Meta).
- After changing env vars on Vercel, **redeploy**.

| Env var | Used for |
|---|---|
| `APP_URL` | Base for all callbacks |
| `PUBLIC_URL` | Optional public base for the Instagram callback and media URLs (never a tunnel URL in production) |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Instagram (the *Instagram* app ID, not the main Meta app ID) |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook (main Meta app ID, App settings → Basic) |

Never commit real secrets - keep `.env.example` as placeholders.

**LinkedIn**
- Products: *Sign In with LinkedIn using OpenID Connect* + *Share on LinkedIn*.
- Redirect URL: `{APP_URL}/api/linkedin/callback`; scopes `openid profile email w_member_social`.
- Token ~60 days; user reconnects from the dashboard.

**Instagram** (Instagram API with Instagram Login)
- Meta app → use case *Manage messaging & content on Instagram* → *API setup with Instagram login*.
- Redirect URI `{APP_URL}/api/instagram/callback` goes in **Business login settings → OAuth redirect URIs** (save it).
- Scopes: `instagram_business_basic`, `instagram_business_content_publish`; account must be Business/Creator.
- App unpublished → only users with a role can connect: add them as **Instagram Tester** and accept the invite in Instagram.
- The 2FA prompt at Instagram login is controlled by the Instagram account, not this app.

**Facebook Pages**
- Meta app → *Add use cases* → Content management → **Manage everything on your Page**; add permissions `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
- Redirect URI `{APP_URL}/api/facebook/callback` goes in **Facebook Login for Business → Settings → Valid OAuth Redirect URIs** (Client OAuth login + Web OAuth login = Yes; strict mode on).
- Connecting user must be **Admin of the Page** and have a role on the Meta app.
- App in Development mode → posts are visible only to users with an app role; switch to **Live** (Privacy Policy URL, possibly App Review) to make them public.

**Common errors**
- `Invalid redirect_uri` / `redirect_uri_mismatch` → URI not registered, or `APP_URL` / `PUBLIC_URL` points to another host.
- `... integration is not configured on the server` → missing `*_APP_ID` / `*_SECRET`, or no redeploy.
- `413 Request Entity Too Large` → upload over ~4.5 MB on Vercel (see limits above).

## Instagram
Same planner, pick **Instagram** when creating a post (or filter the calendar by platform). Uses the *Instagram API with Instagram Login*.
- Account must be an Instagram **Business or Creator** account (switch in Instagram → Settings → Account type).
- Posts need media: JPEG photos (up to 10 carousel panels) or 1 MP4 (published as a Reel). Caption max 2200 chars. PNG/GIF are not supported by Instagram.
- Photos outside Instagram's supported aspect ratio (4:5 to 1.91:1) are automatically split into ordered carousel panels without cropping the original.
- **Instagram downloads your media from a public URL**. With S3, Vercel Blob, or GridFS on Vercel, the app provides a public HTTPS media URL. With local-disk media (development), `localhost` and private/login-protected tunnels cannot work:
  set `PUBLIC_URL` to an anonymous public HTTPS URL that reaches this app (e.g. an ngrok tunnel to port 3000), which serves `/uploads`, and use the same base for the OAuth redirect: `{PUBLIC_URL}/api/instagram/callback`.
- Setup: developers.facebook.com → create app (type *Business*) → add product **Instagram** → *API setup with Instagram login* →
  add the redirect URI above, copy the **Instagram app ID / secret** into `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`,
  and add your Instagram account under *Roles → Instagram testers* (accept the invite in Instagram) while the app is in development mode.
  Going live for other users requires Meta app review for `instagram_business_basic` and `instagram_business_content_publish`.
- Tokens are long-lived (60 days) and refreshed automatically by the scheduler.
- A LinkedIn and an Instagram post may share the same time slot; two posts on the *same* platform may not.

## Facebook Pages
Connect with Meta OAuth, grant access to one or more managed Pages, then choose the Page that should receive posts.
Facebook personal profiles are not supported. The Facebook integration publishes text, JPEG/PNG photos (up to 10),
photo collections, and MP4 video. Media is delivered through public URLs (S3, GridFS, or Vercel Blob in production; `PUBLIC_URL` for local-disk media - the same requirement as Instagram).

Create a Meta app at developers.facebook.com, configure Facebook Login, and register
`{APP_URL}/api/facebook/callback` as the OAuth redirect URI. Set `FACEBOOK_APP_ID`,
`FACEBOOK_APP_SECRET`, and (optionally) `FACEBOOK_API_VERSION` in the environment. The integration requests
`pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`; development-mode users must be app/test users,
and publishing for other people requires the relevant Meta App Review and access approvals.

## Posting to several networks at once
One composer can target LinkedIn, Instagram, Facebook Pages, or any combination. The backend stores one post per network but ties
them together with a `groupId`, so:
- each network keeps its own status, retries and permalink (one can fail without blocking the others);
- editing any copy updates the whole composed post (copies already published are left alone);
- deleting or "Post now" affects the whole group;
- the shared copy is validated against every target, so selecting Instagram enforces its 2200-character
  caption limit, JPEG-only images and required media; Facebook requires a selected Page and supports up to 10 JPEG/PNG images or MP4.

## Notes
- LinkedIn access tokens are AES-256-GCM encrypted at rest (key derived from `JWT_SECRET` - don't rotate it without reconnecting users).
- Media lives in S3, Vercel Blob, MongoDB GridFS on Vercel, or `UPLOAD_DIR` locally (served at `/uploads/<uuid>`).
- Claiming due posts is atomic in Mongo, so overlapping scheduler runs / several instances are safe.
