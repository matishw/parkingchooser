// Supabase Edge Function: sends "the parking lot is full" Web Push notifications.
//
// Triggered by a Database Webhook on INSERT into public.reservations (see README → Push notifications).
// It re-checks the state in the database itself, so a duplicate or spurious call is harmless:
// claim_full_notification() returns true only once per day, and only when every space open that day is taken.
//
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, optional APP_TIMEZONE.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { notificationPayload, sendToSubscriptions } from '../_shared/push.ts';

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

  try {
    const result = await sendToSubscriptions(
      db,
      subs ?? [],
      notificationPayload('Parking is full', 'All parking spaces are taken for today.', `parking-full-${reserved_for}`),
    );
    return Response.json(result);
  } catch (e) {
    // The day is already claimed; free it so the next booking/release+rebook can retry once this is fixed.
    await db.from('full_notifications').delete().eq('reserved_for', reserved_for);
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
