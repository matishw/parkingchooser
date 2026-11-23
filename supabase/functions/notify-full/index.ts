// Supabase Edge Function: sends "the parking lot is full" Web Push notifications.
//
// Triggered by a Database Webhook on INSERT into public.reservations (see README → Push notifications).
// It re-checks the state in the database itself, so a duplicate or spurious call is harmless:
// claim_full_notification() returns true only once per day, and only when every active space is taken.
//
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, optional APP_TIMEZONE.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import webpush from 'npm:web-push@3.6.7';

interface ReservationRow {
  reserved_for: string;
  user_id: string;
}
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: ReservationRow | null;
}

const TIMEZONE = Deno.env.get('APP_TIMEZONE') ?? 'Asia/Jerusalem';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const payload = (await req.json().catch(() => null)) as WebhookPayload | null;
  if (payload?.type !== 'INSERT' || payload.table !== 'reservations' || !payload.record) {
    return Response.json({ skipped: 'not a reservation insert' });
  }
  const { reserved_for, user_id: lastUser } = payload.record;

  const { data: claimed, error: claimError } = await db.rpc('claim_full_notification', {
    p_date: reserved_for,
    p_tz: TIMEZONE,
  });
  if (claimError) return Response.json({ error: claimError.message }, { status: 500 });
  if (!claimed) return Response.json({ skipped: 'not full, not today, or already notified' });

  // Everyone except the person who just took the last space.
  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .neq('user_id', lastUser);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Payload format understood by Angular's service worker (ngsw): it shows the notification
  // and, on tap, focuses the open app or opens it.
  // Paths are RELATIVE on purpose: the app is served from a sub-path (GitHub Pages: /parkingchooser/).
  // Icons resolve against the service worker's URL, and the click URL against its scope ('' = app root).
  const body = JSON.stringify({
    notification: {
      title: 'Parking is full',
      body: 'All parking spaces are taken for today.',
      icon: 'icons/icon-192x192.png',
      badge: 'icons/icon-96x96.png',
      tag: `parking-full-${reserved_for}`,
      data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '' } } },
    },
  });

  const results = await Promise.allSettled(
    (subs ?? []).map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        TTL: 60 * 60 * 6, // drop it if the device is unreachable for 6 hours
        urgency: 'high',
      }),
    ),
  );

  // 404/410 = the browser revoked this subscription (app uninstalled, permission removed) → forget it.
  const gone = results.flatMap((r, i) => {
    const code = r.status === 'rejected' ? (r.reason as { statusCode?: number })?.statusCode : undefined;
    return code === 404 || code === 410 ? [subs![i].endpoint] : [];
  });
  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone);

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return Response.json({ sent, failed: results.length - sent, removed: gone.length });
});
