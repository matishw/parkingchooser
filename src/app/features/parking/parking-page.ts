import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ParkingService, SpaceView } from '../../core/parking.service';
import { NetworkService } from '../../core/network.service';
import { AuthService } from '../../core/auth.service';
import { AdminSpaces } from '../admin/admin-spaces';
import { Icon } from '../../shared/icons';

@Component({
  selector: 'app-parking-page',
  imports: [DatePipe, Icon, AdminSpaces],
  template: `
    <section class="summary">
      <div>
        <p class="eyebrow">{{ parking.date() | date: 'EEEE, d MMM' }}</p>
        <h1>
          @if (!network.online()) { Offline }
          @else if (!parking.loaded()) { Loading… }
          @else { {{ parking.freeCount() }} of {{ parking.view().length }} free }
        </h1>
        @if (network.online() && parking.myReservation(); as mine) {
          <p class="mine-pill"><app-icon name="car" [size]="18" /> You have <strong>{{ mine.label }}</strong> today
            <span class="small">· booked {{ mine.reservation?.created_at | date: 'd MMM, HH:mm' }}</span></p>
        }
      </div>
      <button type="button" class="icon-btn" aria-label="Refresh availability"
              [disabled]="!network.online() || parking.loading()" (click)="parking.refresh()">
        <span [class.spin]="parking.loading()"><app-icon name="refresh" /></span>
      </button>
    </section>

    @if (parking.error(); as err) {
      <p class="error" role="alert">{{ err }}</p>
    }

    <!-- Availability is never shown from cache: while offline the grid is hidden/disabled. -->
    <ul class="grid" [class.is-offline]="!network.online()" [attr.aria-busy]="parking.loading()">
      @for (s of spaces(); track s.id) {
        <li>
          <button type="button" class="space" [class]="'space space-' + s.state"
                  [disabled]="!network.online() || s.state === 'taken' || parking.busySpaceId() !== null || (s.state === 'free' && !!parking.myReservation())"
                  [attr.aria-label]="ariaLabel(s)" (click)="onTap(s)">
            <span class="space-label">{{ s.label }}</span>
            <span class="space-status">
              @if (parking.busySpaceId() === s.id) { Saving… }
              @else if (s.state === 'free') { {{ parking.myReservation() ? 'Free' : 'Tap to reserve' }} }
              @else if (s.state === 'mine') { Yours · tap to release }
              @else { {{ s.reservation?.user_name }} }
            </span>
            @if (s.reservation && parking.busySpaceId() !== s.id) {
              <span class="space-time">Booked {{ s.reservation.created_at | date: 'd MMM, HH:mm' }}</span>
            }
          </button>
        </li>
      } @empty {
        @if (network.online() && parking.loaded()) { <li class="muted">No parking spaces configured.</li> }
      }
    </ul>

    @if (!network.online()) {
      <div class="offline-card">
        <app-icon name="wifi-off" [size]="40" />
        <p><strong>Live availability unavailable</strong></p>
        <p class="muted">Parking spaces are only shown from the live server. They will refresh automatically when you reconnect.</p>
      </div>
    }

    @if (parking.lastUpdated() && network.online()) {
      <p class="muted small center">Live · updated {{ parking.lastUpdated() | date: 'HH:mm:ss' }}</p>
    }

    @if (auth.isAdmin()) {
      <app-admin-spaces />
    }
  `,
})
export class ParkingPage {
  protected readonly parking = inject(ParkingService);
  protected readonly network = inject(NetworkService);
  protected readonly auth = inject(AuthService);
  protected readonly spaces = computed(() => (this.network.online() ? this.parking.view() : []));

  onTap(s: SpaceView) {
    if (!this.network.online()) return;
    if (s.state === 'free') this.parking.reserve(s);
    else if (s.state === 'mine' && confirm(`Release ${s.label} for today?`)) this.parking.release(s);
  }

  ariaLabel(s: SpaceView) {
    return s.state === 'free' ? `${s.label}, free. Reserve` : s.state === 'mine' ? `${s.label}, reserved by you. Release` : `${s.label}, taken by ${s.reservation?.user_name}`;
  }
}
