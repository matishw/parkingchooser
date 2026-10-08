import { Component, DestroyRef, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { NetworkService } from '../core/network.service';
import { OFFLINE_MESSAGE } from '../core/parking.service';
import { Icon } from './icons';

@Component({
  selector: 'app-status-banners',
  imports: [Icon],
  template: `
    @if (!network.online()) {
      <div class="banner banner-offline" role="alert">
        <app-icon name="wifi-off" [size]="20" />
        <span>{{ offlineMessage }}</span>
      </div>
    }
    @if (updateReady()) {
      <div class="banner banner-update" role="status">
        <span>A new version is available.</span>
        <button type="button" class="btn btn-small" (click)="reload()">Reload</button>
      </div>
    }
  `,
})
export class StatusBanners {
  protected readonly network = inject(NetworkService);
  protected readonly offlineMessage = OFFLINE_MESSAGE;
  protected readonly updateReady = signal(false);

  constructor() {
    const sw = inject(SwUpdate);
    if (!sw.isEnabled) return;
    const sub = sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.updateReady.set(true));
    sw.unrecoverable.subscribe(() => location.reload());
    // Check for a new app shell when the installed app comes back to the foreground.
    const onVisible = () => document.visibilityState === 'visible' && navigator.onLine && sw.checkForUpdate().catch(() => {});
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  reload() {
    document.location.reload();
  }
}
