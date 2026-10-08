import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { NetworkService } from './network.service';

export interface ParkingSpace {
  id: number;
  label: string;
}

export interface Reservation {
  id: string;
  space_id: number;
  reserved_for: string;
  user_id: string;
  user_name: string;
  user_avatar_url: string | null;
  /** When the reservation was made (set by the DB). */
  created_at: string;
}

export interface SpaceView extends ParkingSpace {
  reservation: Reservation | null;
  state: 'free' | 'mine' | 'taken';
}

export const OFFLINE_MESSAGE = 'You are offline. Please connect to the internet to register a parking space.';

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

/**
 * Parking availability is ALWAYS read live from Supabase.
 * Nothing here is persisted or cached; on reconnect / app resume it is re-fetched.
 */
@Injectable({ providedIn: 'root' })
export class ParkingService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkService);

  readonly date = signal(todayIso());
  private readonly spaces = signal<ParkingSpace[]>([]);
  private readonly reservations = signal<Reservation[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly busySpaceId = signal<number | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  readonly view = computed<SpaceView[]>(() => {
    const me = this.auth.user()?.id;
    const byspace = new Map(this.reservations().map((r) => [r.space_id, r]));
    return this.spaces().map((s) => {
      const r = byspace.get(s.id) ?? null;
      return { ...s, reservation: r, state: !r ? 'free' : r.user_id === me ? 'mine' : 'taken' };
    });
  });
  readonly freeCount = computed(() => this.view().filter((s) => s.state === 'free').length);
  readonly myReservation = computed(() => this.view().find((s) => s.state === 'mine') ?? null);

  private channel: RealtimeChannel | null = null;

  constructor() {
    // Start/stop live sync with the auth + network state.
    effect(() => {
      const signedIn = !!this.auth.user();
      const online = this.network.online();
      untracked(() => {
        if (signedIn && online) {
          // Covers first load AND "connection is back": always re-read the authoritative state.
          this.refresh();
          this.subscribe();
        } else {
          this.unsubscribe();
          if (!signedIn) this.clear();
        }
      });
    });

    // App resumed from background (common for installed PWAs) → day may have changed / data is stale.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && this.auth.user() && this.network.online()) {
        this.date.set(todayIso());
        this.refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      this.unsubscribe();
    });
  }

  async refresh(): Promise<void> {
    if (!this.network.online()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [spaces, res] = await Promise.all([
        this.supabase.from('parking_spaces').select('id,label').eq('active', true).order('sort_order'),
        this.supabase
          .from('reservations')
          .select('id,space_id,reserved_for,user_id,user_name,user_avatar_url,created_at')
          .eq('reserved_for', this.date()),
      ]);
      if (spaces.error) throw spaces.error;
      if (res.error) throw res.error;
      this.spaces.set(spaces.data ?? []);
      this.reservations.set(res.data ?? []);
      this.loaded.set(true);
      this.lastUpdated.set(new Date());
    } catch (e) {
      this.handleError(e, 'Could not load parking availability.');
    } finally {
      this.loading.set(false);
    }
  }

  async reserve(space: SpaceView): Promise<void> {
    if (!this.network.online()) {
      this.error.set(OFFLINE_MESSAGE);
      return;
    }
    const user = this.auth.user();
    if (!user || space.state !== 'free' || this.busySpaceId() !== null) return;
    this.busySpaceId.set(space.id);
    this.error.set(null);
    try {
      const { error } = await this.supabase.from('reservations').insert({
        space_id: space.id,
        reserved_for: this.date(),
        user_id: user.id,
        user_name: this.auth.displayName(),
        user_avatar_url: this.auth.avatarUrl(),
      });
      if (error) {
        if (error.code === '23505') {
          this.error.set(
            error.message.includes('one_space_per_user')
              ? 'You already have a space today. Release it first.'
              : `${space.label} was just taken by someone else.`,
          );
        } else throw error;
      }
    } catch (e) {
      this.handleError(e, 'Reservation failed. Please try again.');
    } finally {
      this.busySpaceId.set(null);
      await this.refresh(); // always re-sync with the authoritative state
    }
  }

  async release(space: SpaceView): Promise<void> {
    if (!this.network.online()) {
      this.error.set(OFFLINE_MESSAGE);
      return;
    }
    if (space.state !== 'mine' || !space.reservation || this.busySpaceId() !== null) return;
    this.busySpaceId.set(space.id);
    this.error.set(null);
    try {
      const { error } = await this.supabase.from('reservations').delete().eq('id', space.reservation.id);
      if (error) throw error;
    } catch (e) {
      this.handleError(e, 'Could not release the space. Please try again.');
    } finally {
      this.busySpaceId.set(null);
      await this.refresh();
    }
  }

  private subscribe() {
    if (this.channel) return;
    this.channel = this.supabase
      .channel('reservations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => this.refresh())
      .subscribe((status) => {
        // Re-fetch after (re)joining so nothing missed while disconnected is lost.
        if (status === 'SUBSCRIBED') this.refresh();
      });
  }

  private unsubscribe() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  private clear() {
    this.spaces.set([]);
    this.reservations.set([]);
    this.loaded.set(false);
  }

  private handleError(e: unknown, fallback: string) {
    if (!navigator.onLine) {
      this.error.set(OFFLINE_MESSAGE);
      return;
    }
    if (e instanceof TypeError) {
      // fetch() network failure while the OS still reports a connection (captive portal, flaky signal).
      this.error.set('Cannot reach the server. Check your connection and tap Refresh.');
      return;
    }
    console.error(e);
    this.error.set(fallback);
  }
}
