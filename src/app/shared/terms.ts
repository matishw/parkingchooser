import { Component, ElementRef, Injectable, effect, inject, signal, viewChild } from '@angular/core';
import { Icon } from './icons';

/** Open/close state for the Terms & Privacy sheet, so any screen can link to it. */
@Injectable({ providedIn: 'root' })
export class TermsService {
  readonly open = signal(false);
  show() { this.open.set(true); }
  close() { this.open.set(false); }
}

/** Inline "Terms & Privacy" link that opens the sheet. */
@Component({
  selector: 'app-terms-link',
  template: `<button type="button" class="link-btn" (click)="terms.show()">Terms &amp; Privacy</button>`,
})
export class TermsLink {
  protected readonly terms = inject(TermsService);
}

/** Bottom-sheet with the app's terms of use and privacy notice. */
@Component({
  selector: 'app-terms-sheet',
  imports: [Icon],
  host: { '(document:keydown.escape)': 'terms.close()' },
  template: `
    @if (terms.open()) {
      <div class="sheet-backdrop" (click)="terms.close()"></div>
      <section class="sheet terms" role="dialog" aria-modal="true" aria-labelledby="terms-title" #sheet tabindex="-1">
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="sheet-head terms-head">
          <div>
            <h2 id="terms-title">Terms &amp; Privacy</h2>
            <p class="muted">The short version of how Parking App works and what it stores.</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" (click)="terms.close()"><app-icon name="close" /></button>
        </header>

        <h3>What we store</h3>
        <ul>
          <li>Your name and username, or — if you sign in with Google — your name, email address and profile picture.</li>
          <li>Your bookings: which space, for which day, and when you booked it.</li>
          <li>Passwords are handled by our authentication provider and stored only in hashed form.</li>
        </ul>

        <h3>Who can see it</h3>
        <ul>
          <li>When you book a space, other signed-in users see your name (and picture, if you have one) on that space for the day.</li>
          <li>Administrators can see the booking history and manage spaces.</li>
          <li>We don't sell your data or share it with anyone outside the organization, except the service providers that host the app and its database.</li>
        </ul>

        <h3>Why we store it</h3>
        <p>Only to run the parking booking system: show which spaces are free, prevent double bookings, and let administrators manage the lot.</p>

        <h3>How long we keep it</h3>
        <p>Everything resets every day at 20:00 UTC: today's and future bookings are cleared and all spaces become free again. Past bookings are kept as history. Your account stays until you ask for it to be deleted.</p>

        <h3>Fair use</h3>
        <ul>
          <li>Book only a space you're actually going to use — one space per person per day.</li>
          <li>If your plans change, release the space so someone else can take it.</li>
          <li>Book for yourself only, using your own account.</li>
          <li>Administrators may cancel bookings or remove spaces when needed.</li>
        </ul>

        <h3>Your rights</h3>
        <p>You can ask to see, correct or delete your personal data at any time — contact your administrator.</p>

        <p class="muted small">By signing in or creating an account you agree to these terms.</p>
        <button type="button" class="btn btn-primary btn-block" (click)="terms.close()">Got it</button>
      </section>
    }
  `,
})
export class TermsSheet {
  protected readonly terms = inject(TermsService);
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  constructor() {
    effect(() => this.sheet()?.nativeElement.focus());
  }
}
