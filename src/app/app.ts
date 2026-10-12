import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from './core/auth.service';
import { PwaInstallService } from './core/pwa-install.service';
import { LoginPage } from './features/auth/login-page';
import { RegisterPage } from './features/auth/register-page';
import { ParkingPage } from './features/parking/parking-page';
import { Icon } from './shared/icons';
import { InstallButton } from './shared/install-button';
import { InstallGuide } from './shared/install-guide';
import { StatusBanners } from './shared/status-banners';

@Component({
  selector: 'app-root',
  imports: [LoginPage, RegisterPage, ParkingPage, InstallButton, InstallGuide, StatusBanners, Icon],
  templateUrl: './app.html',
  host: { '[class.standalone]': 'pwa.isStandalone()' },
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly pwa = inject(PwaInstallService);

  /** Signed-out screen. Mirrored in location.hash (#register) so the browser/Android back button works. */
  protected readonly authView = signal<'login' | 'register'>(this.viewFromHash());

  /** True when Register was opened from Login in this session, so "Log in" can just go back. */
  private openedRegisterFromLogin = false;

  constructor() {
    const onHash = () => this.authView.set(this.viewFromHash());
    window.addEventListener('hashchange', onHash);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('hashchange', onHash));

    // Once signed in (e.g. right after registering), drop #register so sign-out lands on Login.
    effect(() => {
      if (this.auth.user() && location.hash) {
        untracked(() => {
          history.replaceState(null, '', location.pathname + location.search);
          this.authView.set('login');
          this.openedRegisterFromLogin = false;
        });
      }
    });
  }

  showRegister() {
    this.openedRegisterFromLogin = true;
    location.hash = 'register';
  }

  showLogin() {
    if (this.openedRegisterFromLogin) {
      this.openedRegisterFromLogin = false;
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      this.authView.set('login');
    }
  }

  confirmSignOut() {
    if (confirm('Sign out of Parking App?')) this.auth.signOut();
  }

  private viewFromHash() {
    return location.hash === '#register' ? 'register' : 'login';
  }
}
