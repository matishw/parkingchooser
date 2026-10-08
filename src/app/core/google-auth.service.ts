/// <reference types="google.accounts" />
import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

export interface GoogleCredential {
  /** Google-signed ID token (JWT). */
  idToken: string;
  /** Raw nonce; Google received its SHA-256 hash, Supabase verifies the match. */
  nonce: string;
}

/**
 * Google Identity Services ("Sign in with Google" button + One Tap).
 * The user signs in with Google itself — no redirect to any other domain.
 */
@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  readonly ready = signal(false);
  readonly loadError = signal<string | null>(null);

  private loading?: Promise<void>;
  private rawNonce = '';
  private onCredential?: (c: GoogleCredential) => void;

  /** Loads the Google script and initializes it. Safe to call repeatedly. */
  async init(onCredential: (c: GoogleCredential) => void): Promise<void> {
    this.onCredential = onCredential;
    await this.loadScript();

    // Fresh nonce per initialization prevents ID-token replay.
    this.rawNonce = randomNonce();
    const hashedNonce = await sha256Hex(this.rawNonce);

    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (res) => this.onCredential?.({ idToken: res.credential, nonce: this.rawNonce }),
      nonce: hashedNonce,
      ux_mode: 'popup',
      auto_select: true, // returning users are signed straight back in
      itp_support: true, // One Tap on Safari / iOS
      use_fedcm_for_prompt: true,
      use_fedcm_for_button: true,
      cancel_on_tap_outside: true,
      context: 'signin',
    } as google.accounts.id.IdConfiguration);
    this.ready.set(true);
  }

  /** Renders Google's official button into `el`. */
  renderButton(el: HTMLElement) {
    if (!this.ready()) return;
    el.replaceChildren();
    google.accounts.id.renderButton(el, {
      type: 'standard',
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'filled_black' : 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'center',
      width: Math.min(400, Math.max(200, Math.floor(el.clientWidth || 320))),
    });
  }

  /** Shows the One Tap / FedCM account chooser. */
  promptOneTap() {
    if (this.ready()) google.accounts.id.prompt();
  }

  /** Stops Google from silently re-selecting the account after sign-out. */
  disableAutoSelect() {
    if (this.ready()) google.accounts.id.disableAutoSelect();
  }

  private loadScript(): Promise<void> {
    if (typeof google !== 'undefined' && google.accounts?.id) return Promise.resolve();
    this.loading ??= new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        this.loading = undefined;
        s.remove();
        this.loadError.set('Could not load Google Sign-In. Check your connection.');
        reject(new Error('GIS load failed'));
      };
      document.head.appendChild(s);
    });
    return this.loading;
  }
}

function randomNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, '');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
