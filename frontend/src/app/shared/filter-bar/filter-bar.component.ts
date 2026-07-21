import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  ChangeDetectionStrategy, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface FilterDef {
  key: string;          // e.g. 'bu', 'project', 'location'
  label: string;        // display label in the dropdown header
  width?: string;       // optional CSS width override e.g. '200px'
}

export interface FilterState {
  [key: string]: string[];  // key → selected values array
}

@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fb-bar">
      @for (f of filters; track f.key) {
        <div class="fb-field" [style.width]="f.width || '155px'">
          <button class="fb-trigger"
            [class.fb-active]="(selected[f.key]?.length || 0) > 0"
            (click)="toggle(f.key)">
            <span class="fb-label">{{ getLabel(f) }}</span>
            <mat-icon class="fb-chevron">{{ openKey === f.key ? 'expand_less' : 'expand_more' }}</mat-icon>
          </button>

          @if (openKey === f.key) {
            <div class="fb-panel" (click)="$event.stopPropagation()">
              <!-- Search -->
              <div class="fb-search-wrap">
                <mat-icon class="fb-search-icon">search</mat-icon>
                <input class="fb-search"
                  [(ngModel)]="searchTerms[f.key]"
                  placeholder="Search..."
                  (ngModelChange)="onSearch()"
                  autofocus>
                @if (searchTerms[f.key]) {
                  <button class="fb-search-clear" (click)="searchTerms[f.key]=''; onSearch()">
                    <mat-icon style="font-size:14px;width:14px;height:14px">close</mat-icon>
                  </button>
                }
              </div>

              <!-- Select All -->
              <div class="fb-option fb-select-all" (click)="toggleAll(f.key)">
                <span class="fb-checkbox" [class.fb-checked]="isAllSelected(f.key)">
                  @if (isAllSelected(f.key)) { <mat-icon style="font-size:14px;width:14px;height:14px;color:white">check</mat-icon> }
                </span>
                <span class="fb-opt-label">Select All</span>
                <span class="fb-count">{{ getOptions(f.key).length }}</span>
              </div>

              <div class="fb-divider"></div>

              <!-- Options -->
              <div class="fb-options-scroll">
                @if (getVisible(f.key).length === 0) {
                  <div class="fb-empty">No matches</div>
                }
                @for (opt of getVisible(f.key); track opt) {
                  <div class="fb-option" (click)="toggleOption(f.key, opt)">
                    <span class="fb-checkbox" [class.fb-checked]="isSelected(f.key, opt)">
                      @if (isSelected(f.key, opt)) { <mat-icon style="font-size:14px;width:14px;height:14px;color:white">check</mat-icon> }
                    </span>
                    <span class="fb-opt-label" [matTooltip]="opt.length > 28 ? opt : ''">
                      {{ opt }}
                    </span>
                  </div>
                }
              </div>

              <!-- Footer -->
              <div class="fb-footer">
                <button class="fb-clear-btn" (click)="clearKey(f.key)">Clear</button>
                <button class="fb-done-btn" (click)="openKey = ''">Done</button>
              </div>
            </div>
          }
        </div>
      }

      <!-- Global clear -->
      @if (hasAnyActive) {
        <button class="fb-global-clear" (click)="clearAll()">
          <mat-icon>close</mat-icon> Clear all
        </button>
        <span class="fb-row-count">{{ rowCount }} row{{ rowCount !== 1 ? 's' : '' }}</span>
      }
    </div>

    <!-- Backdrop to close panel -->
    @if (openKey) {
      <div class="fb-backdrop" (click)="openKey = ''"></div>
    }
  `,
  styles: [`
    .fb-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; position: relative; }

    /* Trigger button */
    .fb-field { position: relative; flex-shrink: 0; }
    .fb-trigger {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; height: 38px; padding: 0 10px;
      border: 1px solid #d0d0d0; border-radius: 6px;
      background: white; cursor: pointer; font-size: 13px; color: #333;
      font-family: inherit; transition: all 0.15s; gap: 6px;
    }
    .fb-trigger:hover { border-color: #1565c0; color: #1565c0; }
    .fb-trigger.fb-active {
      border-color: #1565c0; background: #e8f0fe; color: #1565c0; font-weight: 600;
    }
    .fb-label { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fb-chevron { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; color: inherit; }

    /* Panel */
    .fb-panel {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 500;
      background: white; border: 1px solid #e0e0e0; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15); min-width: 220px; max-width: 280px;
      display: flex; flex-direction: column; overflow: hidden;
    }

    /* Search */
    .fb-search-wrap {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px; border-bottom: 1px solid #f0f0f0; background: #fafafa;
    }
    .fb-search-icon { font-size: 16px; width: 16px; height: 16px; color: #aaa; flex-shrink: 0; }
    .fb-search {
      flex: 1; border: none; outline: none; font-size: 13px;
      font-family: inherit; background: transparent; color: #333;
    }
    .fb-search-clear { border: none; background: none; cursor: pointer; padding: 0; display: flex; align-items: center; color: #aaa; }
    .fb-search-clear:hover { color: #ED1C24; }

    /* Options */
    .fb-options-scroll { max-height: 220px; overflow-y: auto; }
    .fb-option {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 12px; cursor: pointer; font-size: 13px; color: #333;
      transition: background 0.1s;
    }
    .fb-option:hover { background: #f5f7ff; }
    .fb-select-all { background: #fafafa; border-bottom: 1px solid #f0f0f0; font-weight: 600; }
    .fb-select-all:hover { background: #f0f2ff; }
    .fb-divider { height: 1px; background: #f0f0f0; }
    .fb-empty { padding: 12px; text-align: center; color: #aaa; font-size: 12px; }

    /* Checkbox */
    .fb-checkbox {
      width: 16px; height: 16px; border: 1.5px solid #d0d0d0; border-radius: 3px;
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      transition: all 0.1s;
    }
    .fb-checkbox.fb-checked { background: #1565c0; border-color: #1565c0; }

    /* Option label */
    .fb-opt-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fb-count { font-size: 11px; color: #aaa; background: #f0f0f0; padding: 1px 6px; border-radius: 8px; flex-shrink: 0; }

    /* Footer */
    .fb-footer {
      display: flex; justify-content: space-between; padding: 8px 12px;
      border-top: 1px solid #f0f0f0; background: #fafafa;
    }
    .fb-clear-btn {
      border: none; background: none; cursor: pointer; font-size: 12px;
      color: #888; font-family: inherit; padding: 4px 8px; border-radius: 4px;
    }
    .fb-clear-btn:hover { color: #ED1C24; background: #fdecea; }
    .fb-done-btn {
      border: none; background: #1565c0; color: white; cursor: pointer;
      font-size: 12px; font-family: inherit; padding: 4px 12px; border-radius: 4px;
      font-weight: 600;
    }
    .fb-done-btn:hover { background: #0d47a1; }

    /* Global clear + row count */
    .fb-global-clear {
      display: inline-flex; align-items: center; gap: 4px; height: 38px; padding: 0 12px;
      border: 1px solid #ddd; border-radius: 6px; background: white; cursor: pointer;
      font-size: 12px; color: #666; font-family: inherit; transition: all 0.15s;
    }
    .fb-global-clear mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .fb-global-clear:hover { background: #fdecea; border-color: #ED1C24; color: #ED1C24; }
    .fb-row-count {
      font-size: 11px; color: #1565c0; background: #e3f2fd;
      border: 1px solid #90caf9; padding: 4px 10px; border-radius: 10px; font-weight: 600;
    }

    /* Backdrop */
    .fb-backdrop { position: fixed; inset: 0; z-index: 499; }
  `]
})
export class FilterBarComponent implements OnChanges {
  @Input() filters: FilterDef[] = [];
  /** All available options per key — parent computes these (with cascading applied) */
  @Input() options: { [key: string]: string[] } = {};
  @Input() selected: FilterState = {};
  @Input() rowCount = 0;
  @Output() selectedChange = new EventEmitter<FilterState>();

  openKey = '';
  searchTerms: { [key: string]: string } = {};

  ngOnChanges(changes: SimpleChanges) {
    // Initialise searchTerms for any new filter keys
    this.filters.forEach(f => {
      if (!(f.key in this.searchTerms)) this.searchTerms[f.key] = '';
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  getOptions(key: string): string[] {
    return this.options[key] || [];
  }

  getVisible(key: string): string[] {
    const term = (this.searchTerms[key] || '').toLowerCase().trim();
    const all = this.getOptions(key);
    return term ? all.filter(o => o.toLowerCase().includes(term)) : all;
  }

  isSelected(key: string, value: string): boolean {
    return (this.selected[key] || []).includes(value);
  }

  isAllSelected(key: string): boolean {
    const opts = this.getOptions(key);
    if (!opts.length) return false;
    const sel = this.selected[key] || [];
    return opts.every(o => sel.includes(o));
  }

  get hasAnyActive(): boolean {
    return Object.values(this.selected).some(v => v.length > 0);
  }

  getLabel(f: FilterDef): string {
    const sel = this.selected[f.key] || [];
    if (!sel.length) return f.label;
    if (sel.length === this.getOptions(f.key).length) return `${f.label}: All`;
    if (sel.length === 1) return sel[0].length > 16 ? sel[0].slice(0, 14) + '…' : sel[0];
    return `${f.label} (${sel.length})`;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  toggle(key: string) {
    this.openKey = this.openKey === key ? '' : key;
  }

  onSearch() { /* triggers visible list recompute via getVisible() */ }

  toggleOption(key: string, value: string) {
    const current = [...(this.selected[key] || [])];
    const idx = current.indexOf(value);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(value);
    this.emit({ ...this.selected, [key]: current });
  }

  toggleAll(key: string) {
    const opts = this.getOptions(key);
    if (this.isAllSelected(key)) {
      this.emit({ ...this.selected, [key]: [] });
    } else {
      this.emit({ ...this.selected, [key]: [...opts] });
    }
  }

  clearKey(key: string) {
    this.emit({ ...this.selected, [key]: [] });
  }

  clearAll() {
    const cleared: FilterState = {};
    this.filters.forEach(f => cleared[f.key] = []);
    this.emit(cleared);
    this.openKey = '';
  }

  private emit(state: FilterState) {
    this.selectedChange.emit(state);
  }
}
