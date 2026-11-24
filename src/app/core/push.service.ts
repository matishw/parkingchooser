import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { PwaInstallService } from './pwa-install.service';
import { SupabaseService } from './supabase.service';

/** The only account that sees the test-notification button (must match send-test-push/index.ts). */
export const TEST_PUSH_EMAIL = 'matishw@gmail.com';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True when the subscription was created with the app's current VAPID public key. */
function usesAppKey(sub: PushSubscription): boolean {
  const key = sub.options?.applicationServerKey;
  if (!key) return true; // browser doesn't expose it — assume it's fine
  const b64 = btoa(String.fromCharCode(...new Uint8Array(key)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === environment.vapidPublicKey;
}

/**
 * Web Push: "the parking lot is full" alerts, delivered even when the app is in the background or closed.
 * The browser subscription lives in the service worker; we mirror it in Supabase (push_subscriptions)
 * so the notify-full Edge Function can reach this device.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly pwa = inject(PwaInstallService);

  private readonly subscription = toSignal(this.swPush.subscription, { initialValue: null });
  readonly permission = signal<NotificationPermission>('Notification' in window ? Notification.permission : 'denied');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** Browser + service worker can do push, and a VAPID key is configured. */
  readonly supported = this.swPush.isEnabled && 'PushManager' in window && !!environment.vapidPublicKey;
  /** iPhone/iPad in a Safari tab: push exists only once the app is added to the Home Screen. */
  readonly needsInstallFirst = computed(
    () => this.swPush.isEnabled && !!environment.vapidPublicKey && this.pwa.isIos && !this.pwa.isStandalone(),
  );
  readonly enabled = computed(() => !!this.subscription() && this.permission() === 'granted');

  constructor() {
    // Re-link this device to whoever is signed in (also refreshes rotated keys).
    effect(() => {
      const sub = this.subscription();
      debugger
      const user = this.auth.user();
      if (sub && user) untracked(() => this.save(sub).catch((e) => console.error('push save failed', e)));
    });
  }

  async enable(): Promise<void> {
    if (!this.supported || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Must run from a user gesture (required by iOS and Chrome's permission UI).
      const sub = await this.subscribeWithAppKey();
      debugger
      await this.save(sub);
    } catch (e) {
      console.error(e);
      this.error.set(
        Notification.permission === 'denied'
          ? 'Notifications are blocked. Allow them for this app in your browser or phone settings.'
          : 'Could not turn on notifications. Please try again.',
      );
    } finally {
      this.permission.set(Notification.permission);
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.unlink();
      await this.swPush.unsubscribe();
    } catch (e) {
      console.error(e);
      this.error.set('Could not turn off notifications. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Only this account sees the "Send test notification" button. The server re-checks it (send-test-push). */
  readonly isTester = computed(() => this.auth.user()?.email?.toLowerCase() === TEST_PUSH_EMAIL);

  /** What this browser reports, shown under the test button to find where push breaks. */
  readonly diagnostics = computed(() => [
    `Service worker enabled: ${this.swPush.isEnabled ? 'yes' : 'no (dev build, or browser without SW)'}`,
    `Controlled by SW: ${navigator.serviceWorker?.controller ? 'yes' : 'no'}`,
    `PushManager: ${'PushManager' in window ? 'yes' : 'no'}`,
    `Permission: ${this.permission()}`,
    `This device subscribed: ${this.subscription() ? 'yes' : 'no'}`,
    `Installed app: ${this.pwa.isStandalone() ? 'yes' : 'no'}`,
  ]);

  /**
   * Admin test: makes sure this device is subscribed (asks for permission if needed), then asks the
   * send-test-push Edge Function to push "this is a test message" — to the caller's own devices ('me')
   * or to every subscribed device of every user ('all'). Returns a human-readable result.
   */
  async sendTest(scope: 'me' | 'all' = 'me'): Promise<string> {
    if (!this.swPush.isEnabled) return 'Service worker is not enabled here — use the production build / installed app.';
    if (!('PushManager' in window)) return 'This browser has no Push API (e.g. incognito / private window).';
    try {
      let sub = this.subscription();
      if (!sub || Notification.permission !== 'granted' || !usesAppKey(sub)) {
        sub = await this.subscribeWithAppKey();
      }
      this.permission.set(Notification.permission);
      await this.save(sub);
    } catch (e) {
      this.permission.set(Notification.permission);
      console.error(e);
      return Notification.permission === 'denied'
        ? 'Notifications are blocked for this app. Allow them in the browser/site settings and try again.'
        : `Could not subscribe this device: ${errorText(e)}`;
    }

    const { data, error } = await this.supabase.functions.invoke('send-test-push', { body: { scope } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      if (detail?.error) return `Server: ${detail.error}`;
      return `Could not reach the send-test-push function (is it deployed?): ${error.message}`;
    }
    const r = data as {
      users: number; devices: number; sent: number; failed: number; removed: number; errors: string[];
      serverPublicKey?: string;
    };
    let msg =
      scope === 'all'
        ? `Sent to ${r.sent} of ${r.devices} device(s) across ${r.users} user(s).`
        : `Sent to ${r.sent} of ${r.devices} device(s).`;
    if (r.removed) msg += ` Removed ${r.removed} expired subscription(s).`;
    if (r.errors?.length) msg += ` Errors: ${r.errors.join(' | ')}`;
    if (r.errors?.some((e) => e.startsWith('403'))) {
      msg += ' (403 = that device subscribed with an old key; its user must open the app and tap Turn on again.)';
    }
    if (r.serverPublicKey && r.serverPublicKey !== environment.vapidPublicKey) {
      msg +=
        ` KEY MISMATCH: Supabase VAPID_PUBLIC_KEY starts with ${r.serverPublicKey.slice(0, 12)}…, ` +
        `the app's vapidPublicKey starts with ${environment.vapidPublicKey.slice(0, 12)}…`;
    }
    return msg;
  }

  /**
   * Subscribes with the app's VAPID key. A subscription made earlier with another key can't be reused
   * (the push service would reject our signature with "403 invalid JWT"), so it is replaced.
   */
  private async subscribeWithAppKey(): Promise<PushSubscription> {
    const old = this.subscription();
    if (old && !usesAppKey(old)) {
      await this.supabase.rpc('delete_push_subscription', { p_endpoint: old.endpoint });
      await old.unsubscribe();
    }
    return this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
  }

  /** Call before signing out, so the next person on this device doesn't get the previous user's alerts. */
  async unlink(): Promise<void> {
    const sub = this.subscription();
    if (!sub) return;
    const { error } = await this.supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
    if (error) throw error;
  }

  private async save(sub: PushSubscription): Promise<void> {
    const json = sub.toJSON();
    const { error } = await this.supabase.rpc('save_push_subscription', {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.['p256dh'],
      p_auth: json.keys?.['auth'],
    });
    if (error) throw error;
  }
}
