import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Tracks connectivity. ParkingService reacts to `online` flipping back to true by
 * re-fetching availability from Supabase; the UI blocks reservations while offline.
 */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  readonly online = signal(navigator.onLine);

  constructor() {
    const update = () => this.online.set(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}
