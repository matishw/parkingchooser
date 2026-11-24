// Supabase Edge Function: sends "this is a test message" to the CALLER's own subscribed devices.
// Restricted to the test admin (TEST_PUSH_EMAIL), signed in with a Google identity: email+password accounts
// can claim any address, so the email alone proves nothing (same rule as apply_role_grants in schema.sql).
//
// Called from the app with the user's session (supabase.functions.invoke), so JWT verification stays on.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { notificationPayload, sendToSubscriptions, serverPublicKey } from '../_shared/push.ts';

const TEST_PUSH_EMAIL = 'matishw@gmail.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    return await handle(req);
  } catch (e) {
    // Always answer with CORS headers, so the app shows the real error instead of a generic "CORS error".
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data, error: authError } = await db.auth.getUser(jwt);
  const user = data?.user;
  if (authError || !user) return reply({ error: 'Not signed in.' }, 401);

  const isTester =
    user.email?.toLowerCase() === TEST_PUSH_EMAIL &&
    (user.identities ?? []).some(
      (i) => i.provider === 'google' && String(i.identity_data?.['email'] ?? '').toLowerCase() === TEST_PUSH_EMAIL,
    );
  if (!isTester) return reply({ error: 'Not allowed.' }, 403);

  // scope "me" (default): only the caller's devices. scope "all": every subscribed device of every user.
  const body = (await req.json().catch(() => ({}))) as { scope?: string };
  const toAll = body.scope === 'all';

  let query = db.from('push_subscriptions').select('endpoint,p256dh,auth,user_id');
  if (!toAll) query = query.eq('user_id', user.id);
  const { data: subs, error } = await query;
  if (error) return reply({ error: error.message }, 500);
  if (!subs?.length) {
    return reply({ error: toAll ? 'No user has notifications turned on yet.' : 'No subscribed devices for your account.' }, 404);
  }

  const result = await sendToSubscriptions(
    db,
    subs,
    notificationPayload('Parking app', 'this is a test message', `test-${Date.now()}`),
  );
  return reply({
    scope: toAll ? 'all' : 'me',
    users: new Set(subs.map((s) => s.user_id)).size,
    devices: subs.length,
    serverPublicKey: serverPublicKey(),
    ...result,
  });
}
