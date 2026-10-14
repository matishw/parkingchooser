import { Component, computed, inject, signal } from '@angular/core';
import { ParkingService, ParkingSpace } from '../../core/parking.service';
import { NetworkService } from '../../core/network.service';
import { formatDateRange, isAvailableOn } from '../../core/parking-dates';
import { Icon } from '../../shared/icons';

/**
 * Admin-only card for spaces that are available only on a date range (inclusive). Shown only to admins;
 * admin_add_dated_parking_space() / admin_remove_parking_space() enforce the role in the database.
 */
@Component({
  selector: 'app-admin-dated-spaces',
  imports: [Icon],
  template: `
    <section class="admin-card" aria-labelledby="admin-dated-title">
      <p class="eyebrow">Admin</p>
      <h2 id="admin-dated-title">Date-based parking spaces</h2>
      <p class="muted small">Available only from the start date through the end date. Not affected by the daily reset.</p>

      <form class="admin-dated-form" novalidate (submit)="onSubmit($event)" [attr.aria-busy]="parking.addingDatedSpace()">
        <label class="field">
          Parking space
          <input name="label" type="text" maxlength="20" autocomplete="off" placeholder="e.g. 300" required
                 [attr.aria-invalid]="invalid() === 'label'" [attr.aria-describedby]="notice() ? 'admin-dated-msg' : null"
                 [value]="label()" (input)="label.set(value($event)); clearNotice()" [disabled]="parking.addingDatedSpace()" />
        </label>
        <div class="admin-dated-dates">
          <label class="field">
            Start date
            <input name="from" type="date" required [min]="today()" [max]="until() || null"
                   [attr.aria-invalid]="invalid() === 'dates'" [attr.aria-describedby]="notice() ? 'admin-dated-msg' : null"
                   [value]="from()" (input)="from.set(value($event)); clearNotice()" [disabled]="parking.addingDatedSpace()" />
          </label>
          <label class="field">
            End date
            <input name="until" type="date" required [min]="from() || today()"
                   [attr.aria-invalid]="invalid() === 'dates'" [attr.aria-describedby]="notice() ? 'admin-dated-msg' : null"
                   [value]="until()" (input)="until.set(value($event)); clearNotice()" [disabled]="parking.addingDatedSpace()" />
          </label>
        </div>
        <button type="submit" class="btn btn-primary btn-block" [disabled]="parking.addingDatedSpace() || !network.online()">
          {{ parking.addingDatedSpace() ? 'Adding…' : 'Add Parking Space' }}
        </button>
      </form>

      @if (notice(); as n) {
        <small id="admin-dated-msg" [class]="n.ok ? 'muted' : 'field-error'" [attr.role]="n.ok ? 'status' : 'alert'">{{ n.text }}</small>
      }

      <ul class="admin-list admin-dated-list" [attr.aria-busy]="parking.removingSpaceId() !== null">
        @for (s of rows(); track s.id) {
          <li>
            <span class="admin-list-label">
              {{ s.label }}
              <span class="muted small admin-dated-range">{{ s.range }}{{ s.openToday ? ' · available today' : '' }}</span>
            </span>
            @if (s.bookedBy) { <span class="muted small">Booked today</span> }
            <button type="button" class="icon-btn icon-btn-danger" [attr.aria-label]="'Remove ' + s.label + ', ' + s.range"
                    [disabled]="!network.online() || parking.removingSpaceId() !== null" (click)="remove(s)">
              <span [class.spin]="parking.removingSpaceId() === s.id">
                <app-icon [name]="parking.removingSpaceId() === s.id ? 'refresh' : 'trash'" [size]="20" />
              </span>
            </button>
          </li>
        } @empty {
          @if (parking.loaded()) { <li class="muted">No current or upcoming date-based spaces.</li> }
        }
      </ul>
    </section>
  `,
})
export class AdminDatedSpaces {
  protected readonly parking = inject(ParkingService);
  protected readonly network = inject(NetworkService);
  protected readonly label = signal('');
  protected readonly from = signal('');
  protected readonly until = signal('');
  protected readonly today = this.parking.date;
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  /** Which input the error message belongs to. */
  protected readonly invalid = signal<'label' | 'dates' | null>(null);

  protected readonly rows = computed(() => {
    const today = this.parking.date();
    const booked = new Map(this.parking.view().map((v) => [v.id, v.reservation?.user_name ?? null]));
    return this.parking.datedSpaces().map((s) => ({
      ...s,
      range: formatDateRange(s.available_from!, s.available_until!),
      openToday: isAvailableOn(s, today),
      bookedBy: booked.get(s.id) ?? null,
    }));
  });

  protected value(e: Event) {
    return (e.target as HTMLInputElement).value;
  }

  protected clearNotice() {
    this.notice.set(null);
    this.invalid.set(null);
  }

  protected async onSubmit(e: Event) {
    e.preventDefault();
    if (this.parking.addingDatedSpace()) return;
    const value = this.label().trim();
    const [from, until] = [this.from(), this.until()];
    const err = await this.parking.addDatedSpace(value, from, until);
    if (err) {
      // Range problems mention dates; duplicates ("already …") and everything else belong to the label.
      this.invalid.set(/date/i.test(err) && !/already/i.test(err) ? 'dates' : 'label');
      this.notice.set({ ok: false, text: err });
      return;
    }
    this.notice.set({ ok: true, text: `${value} added — available ${formatDateRange(from, until)}.` });
    this.label.set('');
    this.from.set('');
    this.until.set('');
  }

  protected async remove(s: ParkingSpace & { range: string; bookedBy: string | null }) {
    const warning = s.bookedBy ? `\n\n${s.label} is booked today by ${s.bookedBy}. That booking will be cancelled.` : '';
    if (!confirm(`Remove parking space ${s.label} (${s.range})? Users will no longer be able to select it.${warning}`)) return;
    this.invalid.set(null);
    const err = await this.parking.removeSpace(s);
    this.notice.set(err ? { ok: false, text: err } : { ok: true, text: `${s.label} (${s.range}) removed.` });
  }
}
