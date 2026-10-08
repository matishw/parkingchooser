import { Component, inject, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { NetworkService } from '../../core/network.service';
import { PASSWORD_MIN_LENGTH, RegistrationErrors, RegistrationForm, validateRegistration } from './auth-validators';

@Component({
  selector: 'app-register-page',
  template: `
    <section class="login">
      <img src="icons/icon-192x192.png" width="72" height="72" alt="" class="login-logo" />
      <h1>Create account</h1>
      <p class="muted">Sign up with a username and password.</p>

      <form class="auth-form" novalidate (submit)="onSubmit($event)">
        @for (f of fields; track f.key) {
          <label class="field">
            <span>{{ f.label }}</span>
            <input [name]="f.key" [type]="f.type" [attr.autocomplete]="f.autocomplete" required
                   [attr.autocapitalize]="f.key === 'username' ? 'none' : null"
                   [attr.aria-invalid]="!!errors()[f.key]"
                   [value]="form()[f.key]" (input)="update(f.key, $event)" [disabled]="busy()" />
            @if (errors()[f.key]; as msg) { <small class="field-error">{{ msg }}</small> }
            @else if (f.hint) { <small class="muted">{{ f.hint }}</small> }
          </label>
        }
        <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !network.online()">
          {{ busy() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      @if (!network.online()) { <p class="muted">Connect to the internet to create an account.</p> }
      @if (error(); as err) { <p class="error" role="alert">{{ err }}</p> }

      <p class="muted switch-auth">Already have an account? <button type="button" class="link-btn" (click)="login.emit()">Log in</button></p>
    </section>
  `,
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkService);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = signal<RegistrationForm>({ firstName: '', lastName: '', username: '', password: '', confirmPassword: '' });
  protected readonly errors = signal<RegistrationErrors>({});
  readonly login = output<void>();

  protected readonly fields: { key: keyof RegistrationForm; label: string; type: string; autocomplete: string; hint?: string }[] = [
    { key: 'firstName', label: 'First name', type: 'text', autocomplete: 'given-name' },
    { key: 'lastName', label: 'Last name', type: 'text', autocomplete: 'family-name' },
    { key: 'username', label: 'Username', type: 'text', autocomplete: 'username', hint: 'Letters, numbers, . _ -' },
    { key: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: `At least ${PASSWORD_MIN_LENGTH} characters` },
    { key: 'confirmPassword', label: 'Confirm password', type: 'password', autocomplete: 'new-password' },
  ];

  protected update(key: keyof RegistrationForm, e: Event) {
    this.form.update((f) => ({ ...f, [key]: (e.target as HTMLInputElement).value }));
    // Clear a field's error as soon as the user edits it.
    if (this.errors()[key]) this.errors.update(({ [key]: _, ...rest }) => rest);
  }

  protected async onSubmit(e: Event) {
    e.preventDefault();
    if (this.busy() || !this.network.online()) return;
    const errors = validateRegistration(this.form());
    this.errors.set(errors);
    this.error.set(null);
    if (Object.keys(errors).length) return;

    this.busy.set(true);
    const err = await this.auth.signUpWithUsername(this.form());
    // On success the new session switches the app to the parking page.
    if (err) {
      if (err === 'This username is already taken.') this.errors.set({ username: err });
      else this.error.set(err);
      this.busy.set(false);
    }
  }
}
