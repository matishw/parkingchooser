import { Component, ElementRef, effect, inject, output, signal, untracked, viewChild } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { GoogleAuthService, GoogleCredential } from '../../core/google-auth.service';
import { NetworkService } from '../../core/network.service';
import { InstallButton } from '../../shared/install-button';

@Component({
  selector: 'app-login-page',
  imports: [InstallButton],
  template: `
    <section class="login">
      <img src="icons/icon-192x192.png" width="88" height="88" alt="" class="login-logo" />
      <h1>Parking App</h1>
      <p class="muted">Reserve a shared parking space in one tap.</p>

      <form class="auth-form" novalidate (submit)="onSubmit($event)">
        <label class="field">
          <span>Username</span>
          <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required
                 [value]="username()" (input)="username.set(value($event))" [disabled]="busy()" />
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required
                 [value]="password()" (input)="password.set(value($event))" [disabled]="busy()" />
        </label>
        <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !network.online()">
          {{ busy() ? 'Signing in…' : 'Log in' }}
        </button>
      </form>

      <div class="divider"><span>or</span></div>

      <div class="login-actions">
        <!-- Google's official "Sign in with Google" button is rendered here -->
        <div class="google-btn" #googleBtn [hidden]="!network.online() || !google.ready() || busy()"></div>

        @if (!network.online()) {
          <p class="muted">Connect to the internet to sign in.</p>
        } @else if (!google.ready() && !google.loadError()) {
          <p class="muted">Loading Google Sign-In…</p>
        }
        <app-install-button [block]="true" />
      </div>
      @if (error() || google.loadError(); as err) { <p class="error" role="alert">{{ err }}</p> }

      <p class="muted switch-auth">New here? <button type="button" class="link-btn" (click)="register.emit()">Create account</button></p>
    </section>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  protected readonly google = inject(GoogleAuthService);
  protected readonly network = inject(NetworkService);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly username = signal('');
  protected readonly password = signal('');
  readonly register = output<void>();
  private readonly btn = viewChild.required<ElementRef<HTMLElement>>('googleBtn');

  constructor() {
    // (Re)initialize Google Sign-In whenever we are online (also after reconnecting).
    effect(() => {
      if (!this.network.online()) return;
      const el = this.btn().nativeElement;
      untracked(async () => {
        try {
          this.google.loadError.set(null);
          await this.google.init((c) => this.onGoogleCredential(c));
          this.google.renderButton(el);
          this.google.promptOneTap();
        } catch {
          /* loadError already set */
        }
      });
    });
  }

  protected value(e: Event) {
    return (e.target as HTMLInputElement).value;
  }

  protected async onSubmit(e: Event) {
    e.preventDefault();
    if (this.busy() || !this.network.online()) return;
    if (!this.username().trim() || !this.password()) {
      this.error.set('Enter your username and password.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const err = await this.auth.signInWithUsername(this.username(), this.password());
    // On success the session switches the app to the parking page.
    if (err) {
      this.error.set(err);
      this.busy.set(false);
    }
  }

  private async onGoogleCredential({ idToken, nonce }: GoogleCredential) {
    this.busy.set(true);
    this.error.set(null);
    const { error } = await this.auth.signInWithGoogleIdToken(idToken, nonce);
    if (error) {
      this.error.set(error.message);
      this.busy.set(false);
      // Nonce is single-use: re-init so the user can try again.
      await this.google.init((c) => this.onGoogleCredential(c));
      this.google.renderButton(this.btn().nativeElement);
    }
  }
}
