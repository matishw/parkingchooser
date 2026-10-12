import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthError, AuthRetryableFetchError, type Session, type User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { normalizeUsername } from '../features/auth/auth-validators';
import { SupabaseService } from './supabase.service';
import { GoogleAuthService } from './google-auth.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly google = inject(GoogleAuthService);

  private readonly session = signal<Session | null>(null);
  readonly ready = signal(false);
  readonly user = computed<User | null>(() => this.session()?.user ?? null);
  readonly displayName = computed(() => {
    const u = this.user();
    return (u?.user_metadata?.['full_name'] as string) || (u?.user_metadata?.['name'] as string) || u?.email || '';
  });
  readonly avatarUrl = computed(() => (this.user()?.user_metadata?.['avatar_url'] as string) ?? null);
  /** Stable across token refreshes (unlike user()), so the role isn't re-fetched every hour. */
  private readonly userId = computed(() => this.user()?.id ?? null);
  /**
   * Only decides whether admin UI is shown. The real check is done by the database
   * (is_admin() inside every admin RPC / RLS policy), so faking this flag grants nothing.
   */
  readonly isAdmin = signal(false);

  constructor() {
    this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.ready.set(true);
    });
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.ready.set(true);
    });

    effect(() => {
      const id = this.userId();
      untracked(() => this.loadRoles(id));
    });
  }

  private async loadRoles(userId: string | null) {
    this.isAdmin.set(false);
    if (!userId) return;
    const { data, error } = await this.supabase.rpc('is_admin');
    if (error) console.error(error);
    if (this.userId() === userId) this.isAdmin.set(data === true); // ignore a stale answer after switching users
  }

  /**
   * Called with the ID token Google issued after the user signed in with Google.
   * Supabase only verifies that Google token (signature, audience, nonce) and opens a
   * database session for that Google user, so Row Level Security knows who is reserving.
   */
  signInWithGoogleIdToken(idToken: string, nonce: string) {
    return this.supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce });
  }

  /**
   * Username + password accounts. Supabase Auth identifies users by email, so the username is
   * mapped to an internal address (see environment.usernameEmailDomain). Supabase hashes the
   * password; the app never stores it. The unique email in auth.users keeps usernames unique.
   */
  async signUpWithUsername(f: { firstName: string; lastName: string; username: string; password: string }): Promise<string | null> {
    const firstName = f.firstName.trim();
    const lastName = f.lastName.trim();
    const username = normalizeUsername(f.username);
    const email = this.usernameToEmail(username);
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password: f.password,
      options: { data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`, username } },
    });
    if (error) return this.authErrorMessage(error);
    // With "Confirm email" enabled, Supabase returns no session (and hides duplicate usernames).
    if (!data.session) {
      if (data.user && !data.user.identities?.length) return 'This username is already taken.';
      return 'Account created, but sign-in requires disabling "Confirm email" in Supabase (Authentication → Providers → Email).';
    }
    return null;
  }

  async signInWithUsername(username: string, password: string): Promise<string | null> {
    const { error } = await this.supabase.auth.signInWithPassword({ email: this.usernameToEmail(username), password });
    return error ? this.authErrorMessage(error) : null;
  }

  private usernameToEmail(username: string) {
    return `${normalizeUsername(username)}@${environment.usernameEmailDomain}`;
  }

  private authErrorMessage(e: AuthError): string {
    switch (e.code) {
      case 'user_already_exists':
      case 'email_exists':
        return 'This username is already taken.';
      case 'invalid_credentials':
        return 'Incorrect username or password.';
      case 'email_not_confirmed':
        return 'This account is not confirmed. Disable "Confirm email" in Supabase and register again.';
      case 'email_provider_disabled':
      case 'signup_disabled':
        return 'Username sign-up is disabled. Enable the Email provider in Supabase.';
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
        return 'Too many attempts. Please wait a minute and try again.';
    }
    if (e instanceof AuthRetryableFetchError) return 'Cannot reach the server. Check your connection.';
    return e.message;
  }

  signOut() {
    this.google.disableAutoSelect();
    return this.supabase.auth.signOut();
  }
}
