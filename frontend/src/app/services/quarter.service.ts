import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class QuarterService {

  // ── AMD fiscal quarter helpers ──────────────────────────────────────────────
  // AMD FY: Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan
  private calToFiscal(calYear: number, calMonth: number): { fy: number; q: number } {
    const fy = calMonth >= 2 ? calYear : calYear - 1;
    const q = calMonth >= 2 && calMonth <= 4 ? 1
            : calMonth >= 5 && calMonth <= 7 ? 2
            : calMonth >= 8 && calMonth <= 10 ? 3 : 4;
    return { fy, q };
  }

  private toLabel(fy: number, q: number): string {
    return `Q${q} FY${String(fy).slice(-2)}`;
  }

  private parseLabel(label: string): { fy: number; q: number } | null {
    const m = label.match(/Q(\d) FY(\d{2})/);
    if (!m) return null;
    return { q: parseInt(m[1]), fy: 2000 + parseInt(m[2]) };
  }

  private sortKey(label: string): number {
    const p = this.parseLabel(label);
    return p ? p.fy * 4 + p.q : 0;
  }

  // ── Current quarter ─────────────────────────────────────────────────────────
  get currentQuarterLabel(): string {
    const now = new Date();
    const { fy, q } = this.calToFiscal(now.getFullYear(), now.getMonth() + 1);
    return this.toLabel(fy, q);
  }

  // ── Selected quarter signal ─────────────────────────────────────────────────
  selectedQuarter = signal<string>(this.currentQuarterLabel);

  // ── Visible window (7 quarters centred on selected) ────────────────────────
  visibleQuarters = computed<string[]>(() => {
    return this.generateRange(this.selectedQuarter(), 3, 4); // 3 before, 4 after = 8 total
  });

  // ── Navigate ────────────────────────────────────────────────────────────────
  prev() {
    const p = this.parseLabel(this.selectedQuarter());
    if (!p) return;
    let { fy, q } = p;
    q--; if (q < 1) { q = 4; fy--; }
    this.selectedQuarter.set(this.toLabel(fy, q));
  }

  next() {
    const p = this.parseLabel(this.selectedQuarter());
    if (!p) return;
    let { fy, q } = p;
    q++; if (q > 4) { q = 1; fy++; }
    this.selectedQuarter.set(this.toLabel(fy, q));
  }

  jumpTo(label: string) {
    this.selectedQuarter.set(label);
  }

  resetToToday() {
    this.selectedQuarter.set(this.currentQuarterLabel);
  }

  isCurrent(label: string): boolean {
    return label === this.currentQuarterLabel;
  }

  isSelected(label: string): boolean {
    return label === this.selectedQuarter();
  }

  isPast(label: string): boolean {
    return this.sortKey(label) < this.sortKey(this.currentQuarterLabel);
  }

  // ── Generate a range of quarters ────────────────────────────────────────────
  generateRange(anchor: string, before: number, after: number): string[] {
    const p = this.parseLabel(anchor);
    if (!p) return [];
    let { fy, q } = p;
    // Go back `before` quarters
    for (let i = 0; i < before; i++) { q--; if (q < 1) { q = 4; fy--; } }
    const result: string[] = [];
    for (let i = 0; i < before + 1 + after; i++) {
      result.push(this.toLabel(fy, q));
      q++; if (q > 4) { q = 1; fy++; }
    }
    return result;
  }
}
