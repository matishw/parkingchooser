import { Component, inject, input } from '@angular/core';
import { PwaInstallService } from '../core/pwa-install.service';
import { Icon } from './icons';

/** "Install App" — rendered only in a browser tab; hidden automatically inside the installed PWA. */
@Component({
  selector: 'app-install-button',
  imports: [Icon],
  template: `
    @if (pwa.canShowInstallButton()) {
      <button type="button" class="btn btn-install" [class.btn-block]="block()" (click)="pwa.install()">
        <app-icon name="download" [size]="20" /> Install App
      </button>
    }
  `,
})
export class InstallButton {
  protected readonly pwa = inject(PwaInstallService);
  readonly block = input(false);
}
