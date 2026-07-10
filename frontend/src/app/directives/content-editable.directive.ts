import { Directive, ElementRef, Input, OnChanges } from '@angular/core';

/**
 * Directive for contenteditable fields.
 * Only updates innerHTML when the element is NOT focused —
 * prevents cursor reset while user is typing.
 */
@Directive({
  selector: '[safeHtml]',
  standalone: true
})
export class SafeHtmlDirective implements OnChanges {
  @Input() safeHtml: string = '';

  constructor(private el: ElementRef<HTMLElement>) {}

  ngOnChanges() {
    // Never overwrite content while user is actively editing this element
    if (document.activeElement === this.el.nativeElement) return;
    const current = this.el.nativeElement.innerHTML;
    const next = this.safeHtml || '';
    // Only update if value actually changed (avoid unnecessary DOM writes)
    if (current !== next) {
      this.el.nativeElement.innerHTML = next;
    }
  }
}
