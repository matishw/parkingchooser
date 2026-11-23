import { Component, inject } from '@angular/core';
import { PushService } from '../core/push.service';
import { PwaInstallService } from '../core/pwa-install.service';
import { Icon } from './icons';

/** "Notify me when the lot is full" — opt-in for Web Push. */
@Component({
  selector: 'app-notify-toggle',
  imports: [Icon],
  template: `
    @if (push.needsInstallFirst()) {
      <div class="notify-card">
        <app-icon name="bell" [size]="22" />
        <p class="notify-text">
          <strong>Get notified when parking is full</strong>
          <span class="muted small">On iPhone, add the app to your Home Screen first.</span>
        </p>
        <button type="button" class="btn btn-small btn-outline" (click)="pwa.install()">How?</button>
      </div>
    } @else if (push.supported) {
      <div class="notify-card">
        <app-icon [name]="push.enabled() ? 'bell' : 'bell-off'" [size]="22" />
        <p class="notify-text">
          <strong>{{ push.enabled() ? 'Full-lot alerts are on' : 'Notify me when parking is full' }}</strong>
          <span class="muted small">Works even when the app is closed.</span>
        </p>
        <button type="button" class="btn btn-small" [class.btn-primary]="!push.enabled()" [class.btn-outline]="push.enabled()"
                [disabled]="push.busy()" (click)="push.enabled() ? push.disable() : push.enable()">
          {{ push.busy() ? '…' : push.enabled() ? 'Turn off' : 'Turn on' }}
        </button>
      </div>
      @if (push.error(); as err) {
        <p class="error" role="alert">{{ err }}</p>
      }
    }
  `,
})
export class NotifyToggle {
  protected readonly push = inject(PushService);
  protected readonly pwa = inject(PwaInstallService);
}
