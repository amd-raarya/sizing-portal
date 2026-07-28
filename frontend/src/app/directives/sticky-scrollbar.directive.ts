import { Directive, ElementRef, OnInit, OnDestroy, NgZone } from '@angular/core';

/**
 * StickyScrollbarDirective — adds a floating horizontal scrollbar
 * fixed to the bottom of the viewport so users can scroll horizontally
 * without needing to reach the bottom of the table.
 *
 * Usage: add [stickyScrollbar] to any horizontally scrollable container.
 */
@Directive({
  selector: '[stickyScrollbar]',
  standalone: true,
})
export class StickyScrollbarDirective implements OnInit, OnDestroy {
  private floatingBar!: HTMLDivElement;
  private innerBar!: HTMLDivElement;
  private syncing = false;
  private rafId: number | null = null;

  constructor(private el: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      this.createFloatingBar();
      this.attachListeners();
      this.updateBarWidth();
    });
  }

  ngOnDestroy() {
    this.floatingBar?.remove();
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
  }

  private createFloatingBar() {
    this.floatingBar = document.createElement('div');
    this.floatingBar.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 12px;
      overflow-x: auto;
      overflow-y: hidden;
      z-index: 9000;
      background: transparent;
      pointer-events: auto;
    `;

    this.innerBar = document.createElement('div');
    this.innerBar.style.cssText = `height: 1px;`;
    this.floatingBar.appendChild(this.innerBar);
    document.body.appendChild(this.floatingBar);

    // Style the floating scrollbar thumb
    const style = document.createElement('style');
    style.textContent = `
      .floating-scrollbar::-webkit-scrollbar { height: 8px; }
      .floating-scrollbar::-webkit-scrollbar-track { background: #e8e8e8; }
      .floating-scrollbar::-webkit-scrollbar-thumb { background: #888; border-radius: 4px; }
      .floating-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
    `;
    document.head.appendChild(style);
    this.floatingBar.classList.add('floating-scrollbar');
  }

  private attachListeners() {
    const container = this.el.nativeElement;

    // Sync floating bar → table
    this.floatingBar.addEventListener('scroll', () => {
      if (this.syncing) return;
      this.syncing = true;
      container.scrollLeft = this.floatingBar.scrollLeft;
      requestAnimationFrame(() => { this.syncing = false; });
    });

    // Sync table → floating bar
    container.addEventListener('scroll', () => {
      if (this.syncing) return;
      this.syncing = true;
      this.floatingBar.scrollLeft = container.scrollLeft;
      requestAnimationFrame(() => { this.syncing = false; });
    });

    // Show/hide floating bar based on whether container is in viewport
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      const rect = container.getBoundingClientRect();
      // Show only when container is wider than viewport and partially visible
      const hasOverflow = container.scrollWidth > container.clientWidth + 2;
      this.floatingBar.style.display = (entry.isIntersecting && hasOverflow) ? 'block' : 'none';

      // Position floating bar to align with the container's left/right bounds
      if (entry.isIntersecting) {
        this.floatingBar.style.left = rect.left + 'px';
        this.floatingBar.style.right = (window.innerWidth - rect.right) + 'px';
      }
    }, { threshold: [0, 0.1] });

    observer.observe(container);

    // Update width when content changes
    const resizeObserver = new ResizeObserver(() => this.updateBarWidth());
    resizeObserver.observe(container);

    // Update position on window scroll
    window.addEventListener('scroll', () => this.updatePosition(), { passive: true });
    window.addEventListener('resize', () => this.updateBarWidth(), { passive: true });
  }

  private updateBarWidth() {
    const container = this.el.nativeElement;
    this.innerBar.style.width = container.scrollWidth + 'px';
    const hasOverflow = container.scrollWidth > container.clientWidth + 2;
    if (!hasOverflow) {
      this.floatingBar.style.display = 'none';
    }
  }

  private updatePosition() {
    const container = this.el.nativeElement;
    const rect = container.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    const hasOverflow = container.scrollWidth > container.clientWidth + 2;

    if (inView && hasOverflow) {
      this.floatingBar.style.display = 'block';
      this.floatingBar.style.left = Math.max(0, rect.left) + 'px';
      this.floatingBar.style.right = Math.max(0, window.innerWidth - rect.right) + 'px';
    } else {
      this.floatingBar.style.display = 'none';
    }
  }
}
