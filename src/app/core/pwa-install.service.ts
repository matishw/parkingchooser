import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

/** Chromium's non-standard install prompt event. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    __pwaInstallPrompt?: BeforeInstallPromptEvent | null;
  }
  interface Navigator {
    /** iOS Safari: true when launched from the Home Screen. */
    standalone?: boolean;
  }
}

export type InstallPlatform = 'native-prompt' | 'ios' | 'macos-safari' | 'unsupported';

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private readonly deferredPrompt = signal<BeforeInstallPromptEvent | null>(window.__pwaInstallPrompt ?? null);

  /** True when running as an installed app (Android/desktop standalone or iOS Home Screen). */
  readonly isStandalone = signal(detectStandalone());
  readonly justInstalled = signal(false);

  readonly isIos = detectIos();
  /** iOS but not Safari (Chrome/Firefox/Edge on iOS). iOS 16.4+ supports Add to Home Screen there too, via their share menu. */
  readonly isIosNonSafari = this.isIos && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  readonly isMacSafari = detectMacSafari();

  readonly platform = computed<InstallPlatform>(() => {
    if (this.deferredPrompt()) return 'native-prompt';
    if (this.isIos) return 'ios';
    if (this.isMacSafari) return 'macos-safari';
    return 'unsupported';
  });

  /**
   * Browser → show "Install App"; installed PWA → hide it.
   * On Chromium the button appears once the browser says the app is installable
   * (it never fires beforeinstallprompt if the app is already installed).
   */
  readonly canShowInstallButton = computed(
    () => !this.isStandalone() && !this.justInstalled() && this.platform() !== 'unsupported',
  );

  /** iOS / macOS Safari instructions modal. */
  readonly guideOpen = signal(false);

  constructor() {
    const onAvailable = () => this.deferredPrompt.set(window.__pwaInstallPrompt ?? null);
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e as BeforeInstallPromptEvent;
      this.deferredPrompt.set(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      window.__pwaInstallPrompt = null;
      this.deferredPrompt.set(null);
      this.justInstalled.set(true);
    };
    const mq = window.matchMedia('(display-mode: standalone)');
    const onDisplayMode = () => this.isStandalone.set(detectStandalone());

    window.addEventListener('pwa-install-available', onAvailable);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    mq.addEventListener('change', onDisplayMode);

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('pwa-install-available', onAvailable);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener('change', onDisplayMode);
    });
  }

  /** Handler for the "Install App" button. */
  async install(): Promise<void> {
    const prompt = this.deferredPrompt();
    if (prompt) {
      await prompt.prompt(); // shows the native Android / desktop install dialog
      const { outcome } = await prompt.userChoice;
      // A prompt can only be used once.
      window.__pwaInstallPrompt = null;
      this.deferredPrompt.set(null);
      if (outcome === 'accepted') this.justInstalled.set(true);
      return;
    }
    if (this.isIos || this.isMacSafari) {
      this.guideOpen.set(true);
    }
  }

  closeGuide() {
    this.guideOpen.set(false);
  }
}

function detectStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true || // iOS Home Screen
    document.referrer.startsWith('android-app://') // TWA
  );
}

function detectIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as "Macintosh" — detect it via touch support.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function detectMacSafari(): boolean {
  const ua = navigator.userAgent;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints <= 1 && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
}
