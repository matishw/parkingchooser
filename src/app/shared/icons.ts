/** Tiny inline SVG icon set (no icon-font download → faster startup, works offline). */
import { Component, input } from '@angular/core';

export type IconName = 'share' | 'add-square' | 'check' | 'download' | 'wifi-off' | 'refresh' | 'close' | 'logout' | 'car' | 'more' | 'dock';

const PATHS: Record<IconName, string> = {
  share: 'M12 3v12M12 3l-4 4M12 3l4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1',
  'add-square': 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v8M8 12h8',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  download: 'M12 4v11M12 15l-4.5-4.5M12 15l4.5-4.5M5 20h14',
  'wifi-off': 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.7M2 9.5a15 15 0 0 1 4.4-2.9M22 9.5A15 15 0 0 0 11 5.1M12 20h.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  close: 'M6 6l12 12M18 6L6 18',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7.5 13h.01M16.5 13h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  dock: 'M3 5h18v11H3zM7 20h10M12 16v4',
};

@Component({
  selector: 'app-icon',
  host: { 'aria-hidden': 'true', style: 'display:inline-flex;line-height:0' },
  template: `<svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    [attr.stroke-width]="name() === 'more' ? 3.5 : 2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="d()" /></svg>`,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(24);
  protected d = () => PATHS[this.name()];
}
