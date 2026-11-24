import { Component, inject, signal } from '@angular/core';
import { PushService } from '../core/push.service';
import { Icon } from './icons';

/**
 * Test buttons, visible only to TEST_PUSH_EMAIL: send "this is a test message" to your own devices,
 * or to every user who turned notifications on.
 */
@Component({
  selector: 'app-push-test-button',
  imports: [Icon],
  template: `
    @if (push.isTester()) {
      <div class="notify-card push-test">
        <app-icon name="bell" [size]="22" />
        <p class="notify-text">
          <strong>Push test</strong>
          <span class="muted small">Sends "this is a test message".</span>
        </p>
        <div class="push-test-actions">
          <button type="button" class="btn btn-small btn-primary" [disabled]="sending() !== null" (click)="send('me')">
            {{ sending() === 'me' ? 'Sending…' : 'To me' }}
          </button>
          <button type="button" class="btn btn-small btn-outline" [disabled]="sending() !== null" (click)="sendAll()">
            {{ sending() === 'all' ? 'Sending…' : 'To all' }}
          </button>
        </div>
      </div>
      @if (result(); as r) {
        <p class="push-test-result small" role="status">{{ r }}</p>
      }
      <details class="push-test-diag muted small">
        <summary>Diagnostics</summary>
        <ul>
          @for (line of push.diagnostics(); track line) { <li>{{ line }}</li> }
        </ul>
      </details>
    }
  `,
})
export class PushTestButton {
  protected readonly push = inject(PushService);
  protected readonly sending = signal<'me' | 'all' | null>(null);
  protected readonly result = signal<string | null>(null);

  sendAll() {
    if (confirm('Send "this is a test message" to EVERY user who turned notifications on?')) this.send('all');
  }

  async send(scope: 'me' | 'all') {
    this.sending.set(scope);
    this.result.set(null);
    try {
      this.result.set(await this.push.sendTest(scope));
    } finally {
      this.sending.set(null);
    }
  }
}
