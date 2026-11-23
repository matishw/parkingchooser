# Parking App — Angular 22 + Supabase + Google Sign-In + PWA

One codebase, installable on **Android**, **iPhone/iPad** and **desktop** as a Progressive Web App.
No native wrapper — the PWA layer is Angular's own `@angular/service-worker` (`ng add @angular/pwa`).

## Quick start

```bash
npm install
# 1. put your project URL + anon key in src/environments/environment.ts
# 2. run supabase/schema.sql in the Supabase SQL editor
npm start            # dev server (service worker disabled in dev)
npm run build        # production build → dist/parking-app/browser
npx http-server dist/parking-app/browser -p 8080   # test the SW locally (localhost counts as secure)
```

Requires Node **22.22.3+ or 24.15+** (Angular 22 CLI requirement).

## Supabase setup

1. **SQL** – run `supabase/schema.sql`. It creates `parking_spaces` + `reservations`, RLS policies, the
   uniqueness rules (one user per space per day, one space per user per day) and enables Realtime.
   It also sets up **admin roles**: `user_roles` (readable by its owner, writable only from the SQL editor /
   service role) and `is_admin()`. Admins listed in `role_grants_by_email` get the role when they sign in
   with Google. To add one later, run
   `insert into public.role_grants_by_email values ('someone@gmail.com', 'admin'); select public.apply_role_grants(id) from auth.users;`.
   Admins see a **Manage parking spaces** card. Spaces are added through `admin_add_parking_space()`, which
   re-checks the role and rejects empty or duplicate labels on the server. They are removed through
   `admin_remove_parking_space()`, a soft delete (`active = false`) that keeps reservation history and
   cancels today's and future bookings on that space.
   **Date-based spaces:** the **Date-based parking spaces** card adds a space that exists only from a start
   date through an end date (inclusive), via `admin_add_dated_parking_space(label, from, until)`. They are
   `parking_spaces` rows with `available_from` / `available_until` set (both null = permanent space). The server
   rejects an end date before the start date, ranges over a year, the default labels, labels of active
   permanent spaces, and any range that overlaps an active range with the same label (also enforced by the
   `parking_spaces_dated_no_overlap` exclusion constraint, which needs `btree_gist`). Reservations are only
   accepted on days the space is open (`space_open_on()` in the insert policy). Dates are plain `date` values
   compared with `reservations.reserved_for`, the device's local calendar day the app books for; the client
   handles them as `YYYY-MM-DD` strings (`src/app/core/parking-dates.ts`) so no timezone conversion can shift
   a day. Remove one with the trash button (same soft delete as above).
   **Daily reset:** `pg_cron` job `daily-parking-reset` runs `public.daily_parking_reset()` every day at
   **20:00 UTC** (`0 20 * * *`; pg_cron on Supabase always uses UTC). It leaves exactly spaces
   126, 127, 155, 212, 217 and 239 active and free, removes all other *permanent* spaces the same way as the
   admin Remove button, leaves date-based spaces untouched, and deletes reservations from today (UTC) onward;
   past reservations are kept. To change the list, edit `public.default_parking_labels()`. To check it: `select * from cron.job;` and
   `select * from cron.job_run_details order by start_time desc limit 5;`. To run it now:
   `select public.daily_parking_reset();`.
2. **Google Sign-In (direct, no redirect)** – the app uses Google Identity Services (the official
   "Sign in with Google" button + One Tap). The user signs in on Google's own dialog and never leaves the
   app; there is no redirect through `supabase.co`.
   - Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID → Web application**.
   - *Authorized JavaScript origins*: your production origin (e.g. `https://parking.example.com`) plus
     `http://localhost:4200` and `http://localhost:8080` for testing. No redirect URIs are needed.
   - Client ID (already set in `src/environments/environment.ts`): `678078032253-dvtqtfflvgbcrnuo1q0mtpnu6d8d2626.apps.googleusercontent.com`
   - Supabase → Authentication → Providers → Google: enable it and add the same client ID under
     **Authorized Client IDs** (leave "Skip nonce check" off – the app sends a nonce).
3. **How the session works** – Google returns a signed ID token to the app. The app passes it to
   `supabase.auth.signInWithIdToken()`, which only verifies Google's signature/nonce and opens a database
   session for that Google user, so Row Level Security knows who is reserving a space.

## PWA features — where they live

| Requirement | Implementation |
|---|---|
| Service worker | `provideServiceWorker()` in `src/app/app.config.ts`, rules in `ngsw-config.json` |
| Manifest | `public/manifest.webmanifest` (`name`, `short_name`, `display: standalone`, `start_url: /`, `scope: /`, theme/background colors) |
| Icons | `public/icons/` — `any` icons 72–512 px, **maskable** 192/512, `apple-touch-icon` 180 px. Regenerate with `python3 scripts/generate-icons.py` |
| Splash screens | Android: generated from manifest. iOS: `public/splash/*` + `apple-touch-startup-image` links in `src/index.html` |
| Viewport / safe areas | `viewport-fit=cover` meta + `env(safe-area-inset-*)` in `src/styles.scss` |
| Install button | `src/app/shared/install-button.ts` + `src/app/core/pwa-install.service.ts` |
| iOS install guide | `src/app/shared/install-guide.ts` (bottom sheet: Share → Add to Home Screen → Add). Also covers macOS Safari "Add to Dock" |
| Installed detection | `display-mode` media queries (standalone / fullscreen / minimal-ui / window-controls-overlay), `navigator.standalone` (iOS), `appinstalled` event |
| Offline handling | `src/app/core/network.service.ts`, banner in `src/app/shared/status-banners.ts`, guards in `parking.service.ts` |
| App updates | `SwUpdate` → "A new version is available · Reload" banner; checks again whenever the app is brought to the foreground |

### Install button behaviour

| Context | Result |
|---|---|
| Android Chrome / Edge / Samsung Internet, desktop Chrome/Edge | Button appears once the browser fires `beforeinstallprompt`; tap → native install dialog. Hidden after install (`appinstalled`) |
| iPhone / iPad (Safari, and Chrome/Firefox on iOS 16.4+) | Button always shown in the browser; tap → visual Add‑to‑Home‑Screen guide |
| macOS Safari 17+ | Button → "Add to Dock" guide |
| Running as installed PWA (any platform) | No button |
| Browser with no install support (e.g. Firefox desktop) | No button |

`beforeinstallprompt` is captured by a small inline script in `index.html` so it isn't lost if it fires
before Angular finishes bootstrapping.

### Offline / data rules

- The service worker caches **only static app-shell files** (JS, CSS, HTML, icons, splash). There are
  deliberately **no `dataGroups`** — Supabase REST, Auth and Realtime requests always go to the network.
- Availability is never stored in localStorage/IndexedDB and is **hidden while offline** — the grid is
  replaced by an "unavailable" card and the banner reads:
  *"You are offline. Please connect to the internet to register a parking space."*
- Reserve/release are blocked offline (UI disabled + service-level guard).
- On reconnect, on app resume (`visibilitychange`) and after every Realtime (re)subscribe, the app
  re-fetches from Supabase. Every reserve/release is followed by an authoritative re-fetch, and the
  database's unique constraints resolve two people tapping the same space at once.

## Push notifications — "parking is full"

When the last free space of **today** is taken, everyone who opted in gets a notification. It arrives even
when the app is in the background or closed. "Last free space" counts every space open that day:
permanent spaces plus date-based spaces whose range includes today. The person who took the last space
is not notified, and only one notification is sent per day (releasing and re-taking a space doesn't send
a second one).

How it works: the **Notify me** card (`src/app/shared/notify-toggle.ts`, `src/app/core/push.service.ts`)
subscribes the device via Angular's `SwPush` and stores it in `push_subscriptions`. A Database Webhook on
`reservations` INSERT calls the Edge Function `supabase/functions/notify-full`. The function checks
`claim_full_notification()` in the database, which confirms the lot is full and claims the day atomically.
It then sends Web Push to every subscribed device and removes subscriptions the browser has revoked.

### Setup

1. Re-run `supabase/schema.sql` (it adds `push_subscriptions`, `full_notifications` and the functions).
2. VAPID keys (free, generated locally): `npx web-push generate-vapid-keys`. The **public** key goes in
   `src/environments/environment.ts` → `vapidPublicKey`. The **private** key never goes in the repo.
3. Store the keys as Edge Function secrets and deploy the function:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT=mailto:you@example.com APP_TIMEZONE=Asia/Jerusalem
   supabase functions deploy notify-full
   ```
   `APP_TIMEZONE` decides what "today" means (default `Asia/Jerusalem`).
4. Supabase → Database → Webhooks → **Create**: table `public.reservations`, event **Insert**,
   type **Supabase Edge Functions** → `notify-full`, method POST, and enable
   **"Add auth header with service key"**.

### Platform notes

- **Android / desktop Chrome, Edge, Firefox:** works in a tab or installed, including when the app is closed.
- **iPhone / iPad:** iOS 16.4+ and **only from the Home Screen app**. In Safari the card shows
  "add the app to your Home Screen first" and opens the install guide.
- Permission is requested only when the user taps **Turn on** (browsers require a user gesture).
- Signing out detaches the device from the account, so the next person on that device doesn't get alerts.
- Push needs the production service worker: use `npm run build` + a local server, not `npm start`.

## Deployment (HTTPS required)

Service workers and installation only work over **HTTPS** (or `localhost`). Configs are included for:

- **Vercel** – `vercel.json`
- **Netlify** – `netlify.toml`
- **Firebase Hosting** – `firebase.json`

All three serve `dist/parking-app/browser`, rewrite deep links to `index.html`, and send
`Cache-Control: no-cache` for `ngsw-worker.js`, `ngsw.json`, `index.html` and the manifest so updates
roll out reliably. For nginx/other hosts, apply the same three rules. Remember to add the production
origin to Supabase's Redirect URLs.

## Testing checklist on real devices

- **Android Chrome:** open the HTTPS URL → "Install App" → native dialog → launch from home screen
  (no browser UI, splash from manifest) → button gone.
- **iPhone Safari:** "Install App" → guide → Share → Add to Home Screen → Add → open from Home Screen →
  full-screen, splash image, no button. Sign in with Google once inside the installed app (iOS keeps
  installed-app storage separate from Safari). Check that Google's sign-in popup opens and closes
  correctly inside the installed app.
- **Offline:** enable airplane mode in the installed app → app still launches, banner shows, no spaces
  visible; disable airplane mode → availability reloads automatically.
#   p a r k i n g c h o o s e r  
 