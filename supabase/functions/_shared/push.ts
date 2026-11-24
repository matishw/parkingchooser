// Shared Web Push helpers for the Edge Functions (folders starting with "_" are not deployed on their own).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import webpush from 'npm:web-push@3.6.7';
import { createECDH } from 'node:crypto';
import { Buffer } from 'node:buffer';

/** Secrets pasted into the dashboard often pick up spaces, newlines or quotes — strip them. */
function secret(name: string): string {
  return (Deno.env.get(name) ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

const toB64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The public key that really belongs to VAPID_PRIVATE_KEY (P-256), base64url. */
function publicKeyFromPrivate(privateKey: string): string {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  return toB64url(ecdh.getPublicKey());
}

/** VAPID_PUBLIC_KEY as configured on the server (for comparing with the app's key). */
export function serverPublicKey(): string {
  return secret('VAPID_PUBLIC_KEY');
}

// Configured lazily, NOT at module load: a missing/invalid secret would otherwise crash the function on boot,
// so it never answers at all (the browser then only sees a 504 + "CORS error" instead of the real message).
let vapidReady = false;
function configureVapid() {
  if (vapidReady) return;
  const publicKey = secret('VAPID_PUBLIC_KEY');
  const privateKey = secret('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets are not set (supabase secrets set ...).');
  }
  // A mismatched pair makes every push service answer "403 invalid JWT" — catch it here with a clear message.
  let derived: string;
  try {
    derived = publicKeyFromPrivate(privateKey);
  } catch {
    throw new Error('VAPID_PRIVATE_KEY is not a valid key (expected the base64url "Private Key" from web-push).');
  }
  if (derived !== publicKey) {
    throw new Error(
      `VAPID_PRIVATE_KEY does not belong to VAPID_PUBLIC_KEY. The private key's public key starts with ` +
        `${derived.slice(0, 12)}…, but VAPID_PUBLIC_KEY starts with ${publicKey.slice(0, 12)}…`,
    );
  }
  const subject = secret('VAPID_SUBJECT') || 'mailto:admin@example.com';
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) {
    throw new Error('VAPID_SUBJECT must look like "mailto:you@example.com" (no spaces).');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey); // throws on malformed keys
  vapidReady = true;
}

export interface PushRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  sent: number;
  failed: number;
  removed: number;
  errors: string[];
}

/**
 * Payload format understood by Angular's service worker (ngsw): it shows the notification and, on tap,
 * focuses the open app or opens it. Paths are RELATIVE on purpose: the app is served from a sub-path
 * (GitHub Pages: /parkingchooser/). Icons resolve against the service worker's URL, the click URL against
 * its scope ('' = app root).
 */
export function notificationPayload(title: string, body: string, tag: string): string {
  return JSON.stringify({
    notification: {
      title,
      body,
      icon: 'icons/icon-192x192.png',
      badge: 'icons/icon-96x96.png',
      tag,
      data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '' } } },
    },
  });
}

/** Sends to every row; deletes subscriptions the browser revoked (404/410). */
export async function sendToSubscriptions(db: SupabaseClient, subs: PushRow[], payload: string): Promise<SendResult> {
  configureVapid();
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        TTL: 60 * 60 * 6, // drop it if the device is unreachable for 6 hours
        urgency: 'high',
        timeout: 10_000, // never hang the function on a slow push service
      }),
    ),
  );

  const gone: string[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') return;
    const err = r.reason as { statusCode?: number; body?: string; message?: string };
    if (err?.statusCode === 404 || err?.statusCode === 410) gone.push(subs[i].endpoint);
    else errors.push(`${err?.statusCode ?? ''} ${err?.body || err?.message || String(r.reason)}`.trim());
  });
  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone);

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return { sent, failed: results.length - sent, removed: gone.length, errors };
}
