import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { NetworkService } from './network.service';
import { formatDateRange, isAvailableOn, isDateBased, rangesOverlap, validateDateRange } from './parking-dates';

export interface ParkingSpace {
  id: number;
  label: string;
  /** Date-based spaces only ('YYYY-MM-DD', inclusive); null for permanent spaces. See parking-dates.ts. */
  available_from: string | null;
  available_until: string | null;
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
  readonly addingSpace = signal(false);
  readonly addingDatedSpace = signal(false);
  readonly removingSpaceId = signal<number | null>(null);

  /** Spaces open on the selected day: every permanent space plus date-based ones whose range includes it. */
  private readonly daySpaces = computed(() => this.spaces().filter((s) => isAvailableOn(s, this.date())));
  /** Date-based spaces that haven't ended yet (current and upcoming), soonest first — for the admin list. */
  readonly datedSpaces = computed(() =>
    this.spaces()
      .filter(isDateBased)
      .sort((a, b) => a.available_from!.localeCompare(b.available_from!) || a.label.localeCompare(b.label)),
  );

  readonly view = computed<SpaceView[]>(() => {
    const me = this.auth.user()?.id;
    const byspace = new Map(this.reservations().map((r) => [r.space_id, r]));
    return this.daySpaces().map((s) => {
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
        // Permanent spaces plus date-based ones that haven't ended; daySpaces narrows them to the selected day.
        this.supabase
          .from('parking_spaces')
          .select('id,label,available_from,available_until')
          .eq('active', true)
          .or(`available_until.is.null,available_until.gte.${this.date()}`)
          .order('sort_order'),
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

  /**
   * Admin only — the database function re-checks the role and validates, so this can't be bypassed.
   * Returns an error message, or null on success.
   */
  async addSpace(label: string): Promise<string | null> {
    const value = label.trim();
    if (!value) return 'Enter a parking space number or name.';
    if (value.length > 20) return 'Use 20 characters or fewer.';
    const same = this.spacesLabelled(value);
    if (same.some((s) => !isDateBased(s))) return `Parking space ${value} already exists.`;
    if (same.length) {
      return `Parking space ${value} is already scheduled for specific dates. Remove it from the date-based list first.`;
    }
    if (!this.network.online()) return OFFLINE_MESSAGE;
    this.addingSpace.set(true);
    try {
      const { error } = await this.supabase.rpc('admin_add_parking_space', { p_label: value });
      if (error) {
        // Validation / permission messages raised by the function are written for the user.
        if (['23505', '22023', '42501'].includes(error.code)) return error.message;
        throw error;
      }
      await this.refresh();
      return null;
    } catch (e) {
      if (!navigator.onLine) return OFFLINE_MESSAGE;
      console.error(e);
      return 'Could not add the parking space. Please try again.';
    } finally {
      this.addingSpace.set(false);
    }
  }

  /**
   * Admin only — adds a space available only from `from` through `until` (inclusive, 'YYYY-MM-DD').
   * admin_add_dated_parking_space() re-checks the role and every rule here. Returns an error message, or null.
   */
  async addDatedSpace(label: string, from: string, until: string): Promise<string | null> {
    const value = label.trim();
    if (!value) return 'Enter a parking space number or name.';
    if (value.length > 20) return 'Use 20 characters or fewer.';
    const rangeError = validateDateRange(from, until, todayIso());
    if (rangeError) return rangeError;
    const same = this.spacesLabelled(value);
    if (same.some((s) => !isDateBased(s))) return `Parking space ${value} already exists as a permanent space.`;
    const clash = same.find((s) => rangesOverlap(s.available_from!, s.available_until!, from, until));
    if (clash) {
      const range = formatDateRange(clash.available_from!, clash.available_until!);
      return `Parking space ${clash.label} is already available ${range} (overlaps the dates you chose).`;
    }
    if (!this.network.online()) return OFFLINE_MESSAGE;
    this.addingDatedSpace.set(true);
    try {
      const { error } = await this.supabase.rpc('admin_add_dated_parking_space', {
        p_label: value,
        p_from: from,
        p_until: until,
      });
      if (error) {
        if (['23505', '22023', '42501'].includes(error.code)) return error.message;
        throw error;
      }
      await this.refresh();
      return null;
    } catch (e) {
      if (!navigator.onLine) return OFFLINE_MESSAGE;
      console.error(e);
      return 'Could not add the parking space. Please try again.';
    } finally {
      this.addingDatedSpace.set(false);
    }
  }

  /**
   * Admin only — admin_remove_parking_space() re-checks the role. Also cancels today's/future
   * bookings on the space. Returns an error message, or null on success.
   */
  async removeSpace(space: ParkingSpace): Promise<string | null> {
    if (!this.network.online()) return OFFLINE_MESSAGE;
    if (this.removingSpaceId() !== null) return null;
    this.removingSpaceId.set(space.id);
    try {
      const { error } = await this.supabase.rpc('admin_remove_parking_space', { p_space_id: space.id });
      if (error) {
        if (['P0002', '42501'].includes(error.code)) return error.message;
        throw error;
      }
      return null;
    } catch (e) {
      if (!navigator.onLine) return OFFLINE_MESSAGE;
      console.error(e);
      return `Could not remove ${space.label}. Please try again.`;
    } finally {
      this.removingSpaceId.set(null);
      await this.refresh(); // in sync with the DB whether it worked or not (e.g. someone else removed it)
    }
  }

  /** Loaded spaces with this label, ignoring case and surrounding spaces (like the database). */
  private spacesLabelled(label: string) {
    const l = label.trim().toLowerCase();
    return this.spaces().filter((s) => s.label.trim().toLowerCase() === l);
  }

  private subscribe() {
    if (this.channel) return;
    this.channel = this.supabase
      .channel('reservations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => this.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_spaces' }, () => this.refresh())
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
