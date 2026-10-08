import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { PwaInstallService } from '../core/pwa-install.service';
import { Icon } from './icons';

/** Bottom-sheet with "Add to Home Screen" steps for iOS (and "Add to Dock" for macOS Safari). */
@Component({
  selector: 'app-install-guide',
  imports: [Icon],
  host: { '(document:keydown.escape)': 'pwa.closeGuide()' },
  template: `
    @if (pwa.guideOpen()) {
      <div class="sheet-backdrop" (click)="pwa.closeGuide()"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="guide-title" #sheet tabindex="-1">
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="sheet-head">
          <img src="icons/icon-192x192.png" width="56" height="56" alt="" class="sheet-app-icon" />
          <div>
            <h2 id="guide-title">Install Parking App</h2>
            <p class="muted">Add it to your {{ pwa.isMacSafari ? 'Dock' : 'Home Screen' }} for one-tap access, full screen.</p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" (click)="pwa.closeGuide()"><app-icon name="close" /></button>
        </header>

        @if (pwa.isMacSafari) {
          <ol class="steps">
            <li><span class="step-icon"><app-icon name="share" /></span>
              <div><strong>Click the Share button</strong><span class="muted">In the Safari toolbar (or open the File menu).</span></div></li>
            <li><span class="step-icon"><app-icon name="dock" /></span>
              <div><strong>Select “Add to Dock”</strong></div></li>
            <li><span class="step-icon"><app-icon name="check" /></span>
              <div><strong>Confirm by clicking “Add”</strong></div></li>
          </ol>
        } @else {
          <ol class="steps">
            <li><span class="step-icon"><app-icon name="share" /></span>
              <div>
                <strong>Tap the Share button in {{ pwa.isIosNonSafari ? 'your browser' : 'Safari' }}</strong>
                <span class="muted">The square with an arrow pointing up. If you don’t see it, tap
                  <span class="inline-icon"><app-icon name="more" [size]="16" /></span> first.</span>
              </div></li>
            <li><span class="step-icon"><app-icon name="add-square" /></span>
              <div><strong>Select “Add to Home Screen”</strong><span class="muted">Scroll down the share sheet if needed.</span></div></li>
            <li><span class="step-icon"><app-icon name="check" /></span>
              <div><strong>Confirm by tapping “Add”</strong><span class="muted">Then open Parking from your Home Screen.</span></div></li>
          </ol>
        }

        <button type="button" class="btn btn-primary btn-block" (click)="pwa.closeGuide()">Got it</button>
        @if (pwa.isIos) {
          <div class="sheet-pointer" aria-hidden="true">
            <app-icon name="share" [size]="20" />
            <span>Share is in Safari’s toolbar</span>
          </div>
        }
      </section>
    }
  `,
})
export class InstallGuide {
  protected readonly pwa = inject(PwaInstallService);
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  constructor() {
    effect(() => this.sheet()?.nativeElement.focus());
  }
}
