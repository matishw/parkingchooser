import { Component, computed, inject, signal } from '@angular/core';
import { ParkingService, SpaceView } from '../../core/parking.service';
import { NetworkService } from '../../core/network.service';
import { Icon } from '../../shared/icons';

/** Admin-only card for adding / removing parking spaces. Shown only to admins; the database enforces the role. */
@Component({
  selector: 'app-admin-spaces',
  imports: [Icon],
  template: `
    <section class="admin-card" aria-labelledby="admin-spaces-title">
      <p class="eyebrow">Admin</p>
      <h2 id="admin-spaces-title">Manage parking spaces</h2>

      <form class="admin-add" novalidate (submit)="onSubmit($event)">
        <label class="field">
          <input name="label" type="text" maxlength="20" autocomplete="off" placeholder="Search or add, e.g. P9" required
                 aria-label="Search parking spaces, or enter a new one to add" aria-controls="admin-spaces-list"
                 [attr.aria-invalid]="inputInvalid()" [attr.aria-describedby]="notice() ? 'admin-spaces-msg' : null"
                 [value]="label()" (input)="onInput($event)" [disabled]="parking.addingSpace()" />
        </label>
        <button type="submit" class="btn btn-primary" [disabled]="parking.addingSpace() || !network.online()">
          {{ parking.addingSpace() ? 'Adding…' : 'Add' }}
        </button>
      </form>

      @if (notice(); as n) {
        <small id="admin-spaces-msg" [class]="n.ok ? 'muted' : 'field-error'" [attr.role]="n.ok ? 'status' : 'alert'">{{ n.text }}</small>
      }

      @if (query()) {
        <small class="muted" aria-live="polite">{{ filtered().length }} of {{ parking.view().length }} spaces</small>
      }

      <ul id="admin-spaces-list" class="admin-list" [attr.aria-busy]="parking.removingSpaceId() !== null">
        @for (s of filtered(); track s.id) {
          <li>
            <span class="admin-list-label">{{ s.label }}</span>
            @if (s.reservation) { <span class="muted small">Booked today</span> }
            <button type="button" class="icon-btn icon-btn-danger" [attr.aria-label]="'Remove ' + s.label"
                    [disabled]="!network.online() || parking.removingSpaceId() !== null" (click)="remove(s)">
              <span [class.spin]="parking.removingSpaceId() === s.id">
                <app-icon [name]="parking.removingSpaceId() === s.id ? 'refresh' : 'trash'" [size]="20" />
              </span>
            </button>
          </li>
        } @empty {
          @if (query()) { <li class="muted">No space matches “{{ label().trim() }}”. Press Add to create it.</li> }
          @else if (parking.loaded()) { <li class="muted">No parking spaces yet.</li> }
        }
      </ul>
    </section>
  `,
})
export class AdminSpaces {
  protected readonly parking = inject(ParkingService);
  protected readonly network = inject(NetworkService);
  protected readonly label = signal('');
  /** The input doubles as a search box: the list shows spaces whose label contains the text. */
  protected readonly query = computed(() => this.label().trim().toLowerCase());
  protected readonly filtered = computed(() => {
    const q = this.query();
    const all = this.parking.view();
    return q ? all.filter((s) => s.label.toLowerCase().includes(q)) : all;
  });
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  /** The message belongs to the input (failed add), not to a remove. */
  protected readonly inputInvalid = signal(false);

  protected onInput(e: Event) {
    this.label.set((e.target as HTMLInputElement).value);
    this.notice.set(null);
    this.inputInvalid.set(false);
  }

  protected async onSubmit(e: Event) {
    e.preventDefault();
    if (this.parking.addingSpace()) return;
    const value = this.label().trim();
    const err = await this.parking.addSpace(value);
    this.inputInvalid.set(!!err);
    this.notice.set(err ? { ok: false, text: err } : { ok: true, text: `${value} added and available to everyone.` });
    if (!err) this.label.set('');
  }

  protected async remove(s: SpaceView) {
    const warning = s.reservation
      ? `\n\n${s.label} is booked today by ${s.reservation.user_name}. That booking will be cancelled.`
      : '';
    if (!confirm(`Remove parking space ${s.label}? Users will no longer be able to select it.${warning}`)) return;
    this.inputInvalid.set(false);
    const err = await this.parking.removeSpace(s);
    this.notice.set(err ? { ok: false, text: err } : { ok: true, text: `${s.label} removed.` });
  }
}
