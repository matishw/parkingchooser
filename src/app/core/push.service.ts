import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { PwaInstallService } from './pwa-install.service';
import { SupabaseService } from './supabase.service';

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
      const sub = await this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
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
