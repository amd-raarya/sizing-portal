import { ChangeDetectionStrategy, Component, ElementRef, OnInit, afterNextRender, computed, inject, input, model, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

interface OutCell { v: number; over?: boolean; fc?: boolean; fromData?: boolean }
interface OutPeriod { col: string; quarter: string; mi: number }
interface OutQuarter { label: string; forecast: boolean }
interface OutProject { project_id: number; name: string; prov: boolean; est: boolean; hc: number; gapOnly?: boolean; included: boolean; entry_id: number | null; output_name: string | null; seq: number | null }
interface OutLine { kind: 'project' | 'ss'; name?: string; label?: string; prov?: boolean; est?: boolean; flex?: boolean; vals: OutCell[] }
interface OutLayout { group_no: number | null; entries: { entry_id: number; seq: number; output_name: string }[]; active: boolean }
interface OutModel {
  format: string;
  quarters: OutQuarter[];
  periods: OutPeriod[];
  people: { person_id: number; name: string; group: number | null; work: OutCell[]; lines: OutLine[] }[];
  layout?: OutLayout;   // absent when the backend has not been restarted yet
  changes?: OutChanges; // absent when the backend has not been restarted yet
  summary: { label: string; kind: string; vals: number[] }[];
  hasEstimates: boolean;
  flexed: string[];
  flexOn: boolean;
  flexRules: number;
  projects: OutProject[];
  excluded: OutProject[];
  excludedHc: number;
}
interface ChangePerson { person_id: number; name: string; hc: number; was: number | null; delta: number | null; change: 'added' | 'removed' | 'up' | 'down' | 'same' }
interface ChangeProject { name: string; status: 'new' | 'removed' | 'existing'; est: boolean; prov: boolean; people_now: number; added: number; removed: number; changed: number; hc_now: number; people: ChangePerson[] }
interface OutChanges {
  compared: boolean; note: string;
  baseline: { taken_at: string; taken_by: string | null; from: string; to: string; compared_quarters: number } | null;
  quarters: { from: string; to: string };
  totals: { projects: number; projects_new: number; projects_removed: number; people_added: number; people_removed: number; people_changed: number };
  projects: ChangeProject[];
}
interface PreviewRow { key: string; kind: 'person' | 'project' | 'ss' | 'summary'; label: string; sub?: string; est?: boolean; prov?: boolean; summaryKind?: string; personId?: number; cells: OutCell[] }

/**
 * Preview of the Assignment Output: the same numbers as the Excel download (one shared model on the backend),
 * plus a per-project include/exclude list. Excluding only changes the output — the matrix, the views and the
 * saved data are never touched. The choice is remembered per manager.
 */
@Component({
  selector: 'app-output-preview',
  imports: [MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'closed.emit()' },
  template: `
    <div class="op-backdrop" (click)="closed.emit()"></div>
    <div class="op-dialog" role="dialog" aria-modal="true" aria-labelledby="op-title" tabindex="-1" #dialog>

      <header class="op-head">
        <div>
          <h2 id="op-title" class="op-title">Assignment output preview</h2>
          <p class="op-sub">{{ scopeLabel() }} · {{ rangeText() }} · same numbers as the Excel download</p>
        </div>
        <button type="button" class="op-x" (click)="closed.emit()" aria-label="Close preview"><mat-icon>close</mat-icon></button>
      </header>

      @if (loading()) {
        <div class="op-state"><mat-spinner diameter="32"></mat-spinner><span>Building the output…</span></div>
      } @else if (error()) {
        <div class="op-state op-state--err" role="alert"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span></div>
      } @else if (model(); as m) {

        <div class="op-tabs" role="tablist" aria-label="Output views">
          <button type="button" role="tab" id="op-tab-output" class="op-tab" [class.on]="tab() === 'output'" [attr.aria-selected]="tab() === 'output'" aria-controls="op-panel" (click)="tab.set('output')">Output</button>
          <button type="button" role="tab" id="op-tab-summary" class="op-tab" [class.on]="tab() === 'summary'" [attr.aria-selected]="tab() === 'summary'" aria-controls="op-panel" (click)="tab.set('summary')">
            Summary
            @if (changeCount() > 0) { <span class="op-badge" [attr.aria-label]="changeCount() + ' changes'">{{ changeCount() }}</span> }
          </button>
        </div>

        @if (excludedCount() > 0) {
          <div class="op-banner" role="status">
            <mat-icon>visibility_off</mat-icon>
            <span><strong>{{ excludedCount() }} project{{ excludedCount() === 1 ? '' : 's' }} excluded</strong>
              ({{ m.excludedHc }} HC) — left out of this output only. Each person's freed HC moves to their steady state so they keep their full load. Still in the matrix, views and saved data.</span>
            <button type="button" class="op-link" (click)="resetExclusions()" [disabled]="saving()">Reset to include all</button>
          </div>
        }
        @if (m.flexRules > 0) {
          <div class="op-note" role="note">
            <span class="op-tag">ADJ</span>
            @if (useFlex()) {
              <span>Sizing of <strong>{{ m.flexed.join(', ') || 'some projects' }}</strong> is adjusted (moved, extended or scaled). Applied live: change or reset it from the project's calendar icon in the matrix.</span>
            } @else {
              <span>Showing the <strong>approved sizing only</strong>. {{ m.flexRules }} project adjustment{{ m.flexRules === 1 ? ' is' : 's are' }} switched off for this output.</span>
            }
            <label class="op-flexsw"><input type="checkbox" [checked]="useFlex()" (change)="setUseFlex($any($event.target).checked)" /> Include project adjustments</label>
          </div>
        }
        @if (m.hasEstimates) {
          <div class="op-note" role="note">
            <span class="op-tag">EST</span>
            Hatched lines are <strong>estimates</strong> for projects that are not sized yet. They are generated from a bucket curve. Where people are ticked Yes, the estimate goes to those people only and follows their free room: it is cut when they are short and grows when they have more (see the ESTIMATES CUT / GREW rows). With no ticks, it goes to people who usually work on that bucket's projects, then anyone with spare capacity; HC nobody can take shows as hiring gap.
          </div>
        }

        @if (tab() === 'summary') {
          <section class="op-sum" id="op-panel" role="tabpanel" aria-labelledby="op-tab-summary">
            @if (m.changes; as c) {
              <div class="op-sum-top">
                @if (c.compared && c.baseline) {
                  <div class="op-chips" role="group" aria-label="What changed">
                    <span class="op-chip op-chip--new">{{ c.totals.projects_new }} new project{{ c.totals.projects_new === 1 ? '' : 's' }}</span>
                    <span class="op-chip op-chip--add">{{ c.totals.people_added }} people added</span>
                    <span class="op-chip op-chip--rem">{{ c.totals.people_removed }} people removed</span>
                    <span class="op-chip op-chip--chg">{{ c.totals.people_changed }} with changed HC</span>
                    @if (c.totals.projects_removed) { <span class="op-chip op-chip--rem">{{ c.totals.projects_removed }} project{{ c.totals.projects_removed === 1 ? '' : 's' }} dropped</span> }
                  </div>
                  <p class="op-sum-note">Compared with the output last downloaded on <strong>{{ when(c.baseline.taken_at) }}</strong>@if (c.baseline.taken_by) { by {{ c.baseline.taken_by }} }
                    ({{ c.baseline.compared_quarters }} quarter{{ c.baseline.compared_quarters === 1 ? '' : 's' }} in common). Each download becomes the next reference.</p>
                } @else {
                  <p class="op-sum-note">{{ c.note }}</p>
                }
                <div class="op-sum-tools">
                  @if (c.compared) {
                    <label class="op-flexsw"><input type="checkbox" [checked]="onlyChanges()" (change)="onlyChanges.set($any($event.target).checked)" /> Only projects with changes</label>
                  }
                  <span class="op-hint">{{ shownChanges().length }} of {{ c.projects.length }} projects · average HC over {{ c.quarters.from }} → {{ c.quarters.to }}</span>
                </div>
              </div>
              <div class="op-scroll op-sum-list">
                @for (p of shownChanges(); track p.name) {
                  <div class="op-proj" [class.op-proj--new]="p.status === 'new'" [class.op-proj--gone]="p.status === 'removed'">
                    <button type="button" class="op-proj-head" (click)="toggleProj(p)" [attr.aria-expanded]="isProjOpen(p)">
                      <mat-icon>{{ isProjOpen(p) ? 'expand_more' : 'chevron_right' }}</mat-icon>
                      <span class="op-proj-name">{{ p.name }}</span>
                      @if (p.status === 'new') { <span class="op-tag op-tag--new">NEW PROJECT</span> }
                      @if (p.status === 'removed') { <span class="op-tag op-tag--gone">DROPPED</span> }
                      @if (p.est) { <span class="op-tag">EST</span> } @else if (p.prov) { <span class="op-tag op-tag--rev">REVIEW</span> }
                      <span class="op-proj-meta">{{ p.people_now }} {{ p.people_now === 1 ? 'person' : 'people' }} · {{ fmt(p.hc_now) }} HC</span>
                      @if (p.added) { <span class="op-pill op-pill--add">+{{ p.added }}</span> }
                      @if (p.removed) { <span class="op-pill op-pill--rem">−{{ p.removed }}</span> }
                    </button>
                    @if (isProjOpen(p)) {
                      <table class="op-ptable">
                        <caption class="op-sr">People on {{ p.name }}</caption>
                        <thead><tr><th scope="col">Person</th><th scope="col" class="op-num">HC (avg)</th>@if (c.compared) { <th scope="col" class="op-num">Was</th><th scope="col" class="op-num">Delta</th> }<th scope="col">Change</th></tr></thead>
                        <tbody>
                          @for (x of p.people; track x.person_id) {
                            <tr [class]="'op-prow2 op-prow2--' + x.change">
                              <th scope="row">{{ x.name }}</th>
                              <td class="op-num">{{ x.change === 'removed' ? '–' : fmt(x.hc) }}</td>
                              @if (c.compared) {
                                <td class="op-num">{{ x.was ? fmt(x.was) : '–' }}</td>
                                <td class="op-num">{{ x.delta ? (x.delta > 0 ? '+' : '') + fmt(x.delta) : '' }}</td>
                              }
                              <td>{{ changeWord(x.change) }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    }
                  </div>
                } @empty {
                  <p class="op-sum-note">{{ c.compared ? 'No project changed since the last download.' : 'No projects in this output.' }}</p>
                }
              </div>
            } @else {
              <p class="op-sum-note">The summary is not available yet: the backend needs a restart.</p>
            }
          </section>
        } @else {
        <div class="op-body" id="op-panel" role="tabpanel" aria-labelledby="op-tab-output">

          <!-- Include / exclude list -->
          @if (sideMode() === 'hidden') {
            <button type="button" class="op-side-tab" (click)="sideMode.set('normal')" aria-label="Show the list of projects in this output">
              <mat-icon>chevron_right</mat-icon>
              <span>Projects {{ includedCount() }}/{{ m.projects.length }}</span>
            </button>
          } @else {
          <aside class="op-side" [class.op-side--wide]="sideMode() === 'wide'" aria-label="Projects in this output">
            <div class="op-side-head">
              <span>Projects in this output</span>
              <span class="op-count">{{ includedCount() }} of {{ m.projects.length }}</span>
              <span class="op-side-btns">
                <button type="button" class="op-edit" (click)="sideMode.set(sideMode() === 'wide' ? 'normal' : 'wide')" [attr.aria-label]="sideMode() === 'wide' ? 'Make the project list narrower' : 'Make the project list wider to read full names'" [attr.title]="sideMode() === 'wide' ? 'Narrower' : 'Wider (full names)'"><mat-icon>{{ sideMode() === 'wide' ? 'close_fullscreen' : 'open_in_full' }}</mat-icon></button>
                <button type="button" class="op-edit" (click)="sideMode.set('hidden')" aria-label="Hide the project list" title="Hide the list"><mat-icon>chevron_left</mat-icon></button>
              </span>
            </div>
            <ul class="op-plist">
              @for (p of m.projects; track p.project_id) {
                <li>
                  <div class="op-prow">
                    <label class="op-pitem" [class.op-pitem--off]="!p.included">
                      <input type="checkbox" [checked]="p.included" [disabled]="saving()" (change)="toggleProject(p)" [attr.aria-label]="'Include ' + shownName(p) + ' in the output'">
                      <span class="op-pname" [attr.title]="p.output_name && p.output_name !== p.name ? shownName(p) + ' (our name: ' + p.name + ')' : shownName(p)">{{ shownName(p) }}</span>
                      @if (p.est) { <span class="op-tag">EST</span> }
                      @else if (p.prov) { <span class="op-tag op-tag--rev">REVIEW</span> }
                      @if (m.layout?.group_no && !p.entry_id) { <span class="op-tag op-tag--new" title="Not in the list yet: shown at the bottom">NEW</span> }
                      <span class="op-phc">{{ p.gapOnly ? 'gap' : fmt(p.hc) }}</span>
                    </label>
                    @if (m.layout?.group_no) {
                      <button type="button" class="op-edit" (click)="startEdit(p)" [attr.aria-expanded]="editing() === p.project_id" [attr.aria-label]="'Change the output name or place of ' + shownName(p)"><mat-icon>edit</mat-icon></button>
                    }
                  </div>
                  @if (editing() === p.project_id) {
                    <div class="op-editor">
                      <label class="op-elabel" [attr.for]="'nm-' + p.project_id">Name in the output</label>
                      <input class="op-einput" type="text" [id]="'nm-' + p.project_id" [value]="editName()" (input)="editName.set($any($event.target).value)" (keydown.enter)="saveName(p)" maxlength="255">
                      <span class="op-ehint">
                        @if (p.entry_id) { Renames this line of the list for everyone in this team's file. }
                        @else { Adds a new line at the bottom of the list with this name. }
                      </span>
                      @if ((m.layout?.entries ?? []).length) {
                        <label class="op-elabel" [attr.for]="'ln-' + p.project_id">Or put it on an existing line</label>
                        <select class="op-einput" [id]="'ln-' + p.project_id" (change)="placeAt(p, $any($event.target).value)">
                          <option value="">Choose a line…</option>
                          @for (e of (m.layout?.entries ?? []); track e.entry_id) { <option [value]="e.entry_id" [selected]="e.entry_id === p.entry_id">{{ e.seq }}. {{ e.output_name }}</option> }
                        </select>
                      }
                      <span class="op-eactions">
                        <button type="button" class="op-btn op-btn--primary op-btn--sm" [disabled]="saving() || !editName().trim()" (click)="saveName(p)">Save name</button>
                        @if (p.entry_id) { <button type="button" class="op-link" [disabled]="saving()" (click)="unplace(p)">Take out of the list</button> }
                        <button type="button" class="op-link" (click)="editing.set(null)">Cancel</button>
                      </span>
                    </div>
                  }
                </li>
              }
            </ul>
            <p class="op-side-foot">
              Unticked projects are removed from the output only. Remembered for {{ scopeLabel() }}.
              @if (m.layout?.group_no) { <br>Order and names follow the planning file of this team (file {{ m.layout?.group_no }}); projects not in it are at the bottom. }
              @else if (m.layout?.active) { <br>This output spans more than one planning file (or a team with none), so the order and names cannot be edited here. }
            </p>
          </aside>
          }

          <!-- Table -->
          <section class="op-main">
            <div class="op-tools">
              <div class="op-seg" role="group" aria-label="Column detail">
                <button type="button" [class.on]="!months()" [attr.aria-pressed]="!months()" (click)="months.set(false)">Quarters</button>
                <button type="button" [class.on]="months()" [attr.aria-pressed]="months()" (click)="months.set(true)">{{ m.format === 'weekly' ? 'Weeks' : 'Months' }}</button>
              </div>
              <button type="button" class="op-link" (click)="toggleAll()">{{ allOpen() ? 'Collapse all people' : 'Expand all people' }}</button>
              <span class="op-hint">{{ months() ? 'Values as in the Excel columns.' : 'Quarter columns show the average HC per ' + (m.format === 'weekly' ? 'week' : 'month') + '.' }}</span>
            </div>

            <div class="op-scroll">
              <table class="op-table">
                <thead>
                  @if (months()) {
                    <tr class="op-grp">
                      <th class="op-name"></th>
                      @for (g of groups(); track g.label) { <th [attr.colspan]="g.span" [class.op-fc]="g.forecast">{{ g.label }}</th> }
                    </tr>
                  }
                  <tr>
                    <th class="op-name" scope="col">Person / project</th>
                    @for (c of colHeads(); track c.key) { <th scope="col" class="op-num" [class.op-fc]="c.forecast">{{ c.label }}</th> }
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.key) {
                    <tr [class]="'op-r op-r--' + r.kind + (r.summaryKind ? ' op-s--' + r.summaryKind : '') + (r.est ? ' op-r--est' : '')">
                      <th class="op-name" scope="row">
                        @if (r.kind === 'person') {
                          <button type="button" class="op-person" (click)="toggleOpen(r.personId!)" [attr.aria-expanded]="isOpen(r.personId!)">
                            <mat-icon>{{ isOpen(r.personId!) ? 'expand_more' : 'chevron_right' }}</mat-icon>{{ r.label }}
                          </button>
                        } @else {
                          {{ r.label }}
                          @if (r.est) { <span class="op-tag">EST</span> }
                          @else if (r.prov) { <span class="op-tag op-tag--rev">REVIEW</span> }
                          @if (r.sub) { <span class="op-rsub">{{ r.sub }}</span> }
                        }
                      </th>
                      @for (c of r.cells; track $index) {
                        <td class="op-num" [class.op-over]="c.over" [class.op-fc]="c.fc" [class.op-zero]="!c.v">{{ fmt(c.v) }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
        }

        <footer class="op-foot">
          <span class="op-foot-note">
            @if (saving()) { Saving your selection… } @else { Download uses exactly what you see here. }
          </span>
          <button type="button" class="op-btn op-btn--ghost" (click)="closed.emit()">Close</button>
          <button type="button" class="op-btn op-btn--primary" [disabled]="saving() || downloading()" (click)="download.emit()">
            <mat-icon>download</mat-icon> Download Excel
          </button>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; }
    .op-flexsw { margin-left: auto; font-size: 12px; font-weight: 600; color: #1a1a2e; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
    .op-backdrop { position: absolute; inset: 0; background: rgba(20,24,38,0.45); }
    .op-dialog { position: relative; width: min(1280px, 96vw); height: min(820px, 92vh); background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; overflow: hidden; outline: none; }
    .op-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px 10px; border-bottom: 1px solid #eceff4; }
    .op-title { margin: 0; font-size: 18px; font-weight: 800; color: #1a1a2e; }
    .op-sub { margin: 3px 0 0; font-size: 12px; color: #5d6b7e; }
    .op-x { border: none; background: none; cursor: pointer; color: #5d6b7e; border-radius: 8px; padding: 4px; display: flex; }
    .op-x:hover { background: #f1f3f7; }
    .op-x:focus-visible, .op-link:focus-visible, .op-btn:focus-visible, .op-seg button:focus-visible, .op-person:focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }

    .op-tabs { display: flex; gap: 4px; padding: 8px 20px 0; border-bottom: 1px solid #eceff4; }
    .op-tab { border: none; background: none; padding: 8px 16px; font: inherit; font-size: 13px; font-weight: 700; color: #5d6b7e; cursor: pointer; border-bottom: 3px solid transparent; display: inline-flex; align-items: center; gap: 8px; }
    .op-tab.on { color: #1565c0; border-bottom-color: #1565c0; }
    .op-tab:focus-visible { outline: 2px solid #1565c0; outline-offset: -2px; }
    .op-badge { background: #1565c0; color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .op-sum { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 20px; gap: 8px; }
    .op-sum-top { display: flex; flex-direction: column; gap: 6px; }
    .op-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .op-chip { border-radius: 14px; padding: 4px 12px; font-size: 12px; font-weight: 700; }
    .op-chip--new, .op-chip--add { background: #e8f5e9; color: #1b5e20; }
    .op-chip--rem { background: #ffebee; color: #b71c1c; }
    .op-chip--chg { background: #fff8e1; color: #7a4f00; }
    .op-sum-note { margin: 0; font-size: 12px; color: #4a5568; }
    .op-sum-tools { display: flex; align-items: center; gap: 16px; }
    .op-sum-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
    .op-proj { border: 1px solid #dcdfe3; border-radius: 8px; background: #fff; }
    .op-proj--new { border-color: #66bb6a; }
    .op-proj--gone { border-color: #ef9a9a; background: #fffafa; }
    .op-proj-head { width: 100%; display: flex; align-items: center; gap: 8px; border: none; background: none; padding: 8px 10px; font: inherit; cursor: pointer; text-align: left; }
    .op-proj-head:focus-visible { outline: 2px solid #1565c0; outline-offset: -2px; }
    .op-proj-name { font-weight: 700; font-size: 13px; color: #1a1a2e; }
    .op-proj-meta { margin-left: auto; font-size: 12px; color: #4a5568; }
    .op-pill { border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .op-pill--add { background: #e8f5e9; color: #1b5e20; }
    .op-pill--rem { background: #ffebee; color: #b71c1c; }
    .op-tag--gone { background: #ffebee; color: #b71c1c; }
    .op-ptable { width: calc(100% - 20px); margin: 0 10px 10px; border-collapse: collapse; font-size: 12px; }
    .op-ptable th, .op-ptable td { padding: 4px 8px; text-align: left; border-top: 1px solid #eef0f4; font-weight: 400; }
    .op-ptable thead th { font-weight: 700; color: #4a5568; border-top: none; }
    .op-ptable .op-num { text-align: right; }
    .op-prow2--added { background: #e8f5e9; color: #1b5e20; font-weight: 600; }
    .op-prow2--removed { background: #ffebee; color: #b71c1c; text-decoration: line-through; }
    .op-prow2--up, .op-prow2--down { background: #fff8e1; color: #7a4f00; }
    .op-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .op-state { flex: 1; display: flex; align-items: center; justify-content: center; gap: 12px; color: #5d6b7e; }
    .op-state--err { color: #b71c1c; }

    .op-banner { display: flex; align-items: center; gap: 10px; margin: 10px 20px 0; padding: 8px 12px; background: #fff8e1; border: 1px solid #ffe08a; border-radius: 9px; font-size: 12px; color: #5d4300; }
    .op-banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .op-banner .op-link { margin-left: auto; }
    .op-note { display: flex; align-items: center; gap: 8px; margin: 8px 20px 0; padding: 7px 12px; background: #fff3e0; border: 1px dashed #e65100; border-radius: 9px; font-size: 12px; color: #7a2e00; }
    .op-tag { display: inline-block; font-size: 9.5px; font-weight: 800; letter-spacing: 0.4px; color: #8a2f00; background: #ffe0b2; border: 1px dashed #e65100; border-radius: 8px; padding: 0 6px; margin-left: 6px; vertical-align: middle; }
    .op-note .op-tag { margin-left: 0; }
    .op-tag--rev { color: #4a2a8a; background: #ede7f6; border: 1px solid #b39ddb; }
    .op-link { border: none; background: none; color: #0d47a1; font-weight: 700; font-size: 12px; cursor: pointer; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
    .op-link:hover:not(:disabled) { text-decoration: underline; }
    .op-link:disabled { color: #8a94a6; cursor: default; }

    .op-body { flex: 1; min-height: 0; display: flex; gap: 14px; padding: 12px 20px; }
    .op-side { width: 270px; flex-shrink: 0; border: 1px solid #e6e9ef; border-radius: 10px; display: flex; flex-direction: column; min-height: 0; }
    .op-side-head { display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; font-size: 11px; font-weight: 800; color: #3b4658; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #eef1f5; }
    .op-count { font-weight: 600; color: #5d6b7e; text-transform: none; letter-spacing: 0; margin-left: auto; }
    .op-side-btns { display: inline-flex; margin-left: 6px; }
    .op-side-head .op-edit { margin-right: 0; }
    .op-side--wide { width: 480px; }
    .op-side--wide .op-pname { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
    .op-side-tab { flex-shrink: 0; width: 34px; border: 1px solid #e6e9ef; border-radius: 10px; background: #f5f8fd; color: #0d47a1; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0; font: inherit; font-size: 11px; font-weight: 700; }
    .op-side-tab span { writing-mode: vertical-rl; white-space: nowrap; }
    .op-side-tab:hover { background: #e8eef8; }
    .op-side-tab:focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }
    .op-plist { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
    .op-pitem { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; color: #1a1a2e; }
    .op-pitem:hover { background: #f5f8fd; }
    .op-pitem--off .op-pname { text-decoration: line-through; color: #78859a; }
    .op-pitem input { width: 16px; height: 16px; accent-color: #1565c0; flex-shrink: 0; }
    .op-pname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .op-phc { font-size: 11px; color: #5d6b7e; font-variant-numeric: tabular-nums; }
    .op-prow { display: flex; align-items: center; }
    .op-prow .op-pitem { flex: 1; min-width: 0; }
    .op-edit { border: none; background: none; cursor: pointer; color: #5d6b7e; border-radius: 6px; padding: 3px; margin-right: 6px; display: flex; }
    .op-edit:hover { background: #e8eef8; color: #0d47a1; }
    .op-edit mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .op-edit:focus-visible, .op-link:focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }
    .op-tag--new { color: #0d47a1; background: #e3f2fd; border: 1px solid #90caf9; }
    .op-editor { display: flex; flex-direction: column; gap: 4px; margin: 0 10px 8px 12px; padding: 8px 10px; background: #f5f8fd; border: 1px solid #dbe6f6; border-radius: 8px; }
    .op-elabel { font-size: 11px; font-weight: 700; color: #3b4658; }
    .op-einput { height: 30px; border: 1px solid #c9d1dd; border-radius: 7px; padding: 0 8px; font-size: 12px; font-family: inherit; background: #fff; min-width: 0; }
    .op-einput:focus-visible { outline: 2px solid #1565c0; outline-offset: 1px; }
    .op-ehint { font-size: 10.5px; color: #5d6b7e; line-height: 1.35; }
    .op-eactions { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
    .op-btn--sm { height: 28px; padding: 0 12px; font-size: 12px; }
    .op-side-foot { margin: 0; padding: 8px 12px; font-size: 11px; color: #5d6b7e; border-top: 1px solid #eef1f5; line-height: 1.4; }

    .op-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
    .op-tools { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; flex-wrap: wrap; }
    .op-seg { display: inline-flex; border: 1px solid #d8dee8; border-radius: 9px; overflow: hidden; }
    .op-seg button { border: none; background: #fff; padding: 0 14px; height: 30px; font-size: 12px; font-weight: 600; color: #4a5a6e; cursor: pointer; font-family: inherit; }
    .op-seg button.on { background: #1565c0; color: #fff; }
    .op-hint { font-size: 11px; color: #5d6b7e; }
    .op-scroll { flex: 1; min-height: 0; overflow: auto; border: 1px solid #e6e9ef; border-radius: 10px; }
    .op-table { border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 100%; }
    .op-table th, .op-table td { padding: 5px 9px; border-bottom: 1px solid #f0f2f6; white-space: nowrap; }
    .op-table thead th { position: sticky; top: 0; background: #fafbfc; z-index: 2; font-size: 10.5px; font-weight: 700; color: #5d6b7e; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #e6e9ef; }
    .op-grp th { text-align: center; border-left: 1px solid #e6e9ef; color: #3b4658; }
    .op-grp th.op-name { border-left: none; }
    .op-table thead tr:nth-child(2) th { top: 29px; }
    .op-name { position: sticky; left: 0; background: #fff; z-index: 1; text-align: left; min-width: 250px; max-width: 320px; font-weight: 500; color: #1a1a2e; }
    thead .op-name { background: #fafbfc; z-index: 3; }
    .op-num { text-align: right; font-variant-numeric: tabular-nums; min-width: 52px; }
    .op-zero { color: #b0b8c4; }
    td.op-fc, th.op-fc { background: #f4f8ff; }
    td.op-over { color: #b71c1c; font-weight: 800; background: #ffebee; }
    .op-person { display: inline-flex; align-items: center; gap: 2px; border: none; background: none; cursor: pointer; font: inherit; font-weight: 800; color: #1a1a2e; padding: 0; }
    .op-person mat-icon { font-size: 18px; width: 18px; height: 18px; color: #5d6b7e; }
    .op-r--person th, .op-r--person td { background: #f7f9fc; font-weight: 700; }
    .op-r--person td.op-over { background: #ffebee; }
    .op-r--person td.op-fc { background: #eef4ff; }
    .op-r--project .op-name { padding-left: 30px; }
    .op-r--ss .op-name { padding-left: 30px; color: #5d6b7e; }
    .op-r--est th, .op-r--est td { background: repeating-linear-gradient(45deg, #fff3e0, #fff3e0 5px, #ffe9cc 5px, #ffe9cc 10px); color: #7a2e00; }
    .op-rsub { margin-left: 6px; font-size: 10.5px; color: #78859a; }
    .op-r--summary th, .op-r--summary td { font-weight: 800; background: #eef2f7; border-top: 1px solid #d8dee8; }
    .op-s--over th, .op-s--over td { color: #b71c1c; }
    .op-s--hire th, .op-s--hire td { color: #8a2f00; background: #fff3e0; }
    .op-s--fit th, .op-s--fit td { color: #5d4300; background: #f5f0ff; font-weight: 600; font-size: 12px; }
    .op-s--unassigned th, .op-s--unassigned td { color: #5d4300; background: #fff8e1; }
    .op-s--hireProj th, .op-s--hireProj td, .op-s--unassignedProj th, .op-s--unassignedProj td { font-weight: 500; font-size: 11.5px; background: #fff; border-top: none; color: #5d6b7e; }

    .op-foot { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid #eceff4; }
    .op-foot-note { margin-right: auto; font-size: 12px; color: #5d6b7e; }
    .op-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; border: 1px solid transparent; }
    .op-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .op-btn--ghost { background: #fff; border-color: #d8dee8; color: #1a1a2e; }
    .op-btn--primary { background: #1565c0; color: #fff; }
    .op-btn--primary:disabled { background: #9bb8dc; cursor: default; }
  `]
})
export class OutputPreviewComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly manager = input<string>('');
  /** 1–4 = the people of that planning file in the sheet's order (instead of one team); 0 = team output */
  readonly layoutFile = input<number>(0);
  /** what the output is for: the team, or the planning file under its own name */
  readonly scopeLabel = computed(() => (this.layoutFile() ? `Alloc_MLS_Linux_${this.layoutFile()}` : this.manager() || 'All teams'));
  readonly format = input<'monthly' | 'weekly'>('monthly');
  readonly fromQuarter = input<string | undefined>(undefined);
  readonly toQuarter = input<string | undefined>(undefined);
  readonly includeEstimates = input<boolean>(false);
  /** Include the project adjustments (two-way: the page uses the same choice for the download) */
  readonly useFlex = model<boolean>(true);
  readonly downloading = input<boolean>(false);

  readonly closed = output<void>();
  readonly download = output<void>();

  private dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly model = signal<OutModel | null>(null);
  readonly months = signal(false);
  readonly tab = signal<'output' | 'summary'>('output');
  readonly sideMode = signal<'normal' | 'wide' | 'hidden'>('normal');   // project list: normal, wide (full names) or hidden
  readonly onlyChanges = signal(true);
  private projToggled = signal<Set<string>>(new Set());
  readonly changeCount = computed(() => { const t = this.model()?.changes?.totals; return t ? t.projects_new + t.people_added + t.people_removed + t.people_changed + t.projects_removed : 0; });
  readonly shownChanges = computed(() => {
    const c = this.model()?.changes;
    if (!c) return [];
    return c.compared && this.onlyChanges() ? c.projects.filter(p => this.hasChange(p)) : c.projects;
  });
  private hasChange(p: ChangeProject): boolean { return p.status !== 'existing' || p.added > 0 || p.removed > 0 || p.changed > 0; }
  /** Projects with changes start open, the rest closed; a click flips either */
  isProjOpen(p: ChangeProject): boolean { return this.hasChange(p) !== this.projToggled().has(p.name); }
  toggleProj(p: ChangeProject) { this.projToggled.update(s => { const n = new Set(s); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); return n; }); }
  changeWord(c: ChangePerson['change']): string { return c === 'added' ? 'Added' : c === 'removed' ? 'Removed' : c === 'up' ? 'More HC' : c === 'down' ? 'Less HC' : ''; }
  when(iso: string): string { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  private open = signal<Set<number>>(new Set());

  readonly rangeText = computed(() => {
    const m = this.model();
    if (!m || !m.quarters.length) return this.fromQuarter() && this.toQuarter() ? `${this.fromQuarter()} → ${this.toQuarter()}` : 'all quarters with data';
    return `${m.quarters[0].label} → ${m.quarters[m.quarters.length - 1].label}`;
  });
  readonly excludedCount = computed(() => this.model()?.excluded.length ?? 0);
  readonly includedCount = computed(() => (this.model()?.projects ?? []).filter(p => p.included).length);
  readonly allOpen = computed(() => { const m = this.model(); return !!m && m.people.length > 0 && this.open().size >= m.people.length; });

  /** Columns: one per quarter (average of its periods) or one per period (month / week). */
  readonly colHeads = computed(() => {
    const m = this.model();
    if (!m) return [];
    const fc = new Map(m.quarters.map(q => [q.label, q.forecast]));
    return this.months()
      ? m.periods.map((p, i) => ({ key: `p${i}`, label: p.col, forecast: !!fc.get(p.quarter) }))
      : m.quarters.map(q => ({ key: q.label, label: q.label, forecast: q.forecast }));
  });
  readonly groups = computed(() => {
    const m = this.model();
    if (!m) return [];
    return m.quarters.map(q => ({ label: q.label, forecast: q.forecast, span: m.periods.filter(p => p.quarter === q.label).length }));
  });

  readonly rows = computed<PreviewRow[]>(() => {
    const m = this.model();
    if (!m) return [];
    const open = this.open();
    const months = this.months();
    const idx = m.quarters.map(q => m.periods.map((p, i) => (p.quarter === q.label ? i : -1)).filter(i => i >= 0));
    // Collapse month/week values to a quarter average unless the user asked for the raw columns
    const agg = <T extends { v: number }>(vals: T[]): OutCell[] => months
      ? vals.map(c => ({ ...(c as OutCell) }))
      : idx.map(ix => {
          const part = ix.map(i => vals[i]);
          const avg = part.length ? part.reduce((s, c) => s + c.v, 0) / part.length : 0;
          const any = part as OutCell[];
          return { v: avg, over: any.some(c => c.over) && avg > 1.005, fc: any.some(c => c.fc), fromData: any.every(c => c.fromData) };
        });
    const aggNum = (vals: number[]): OutCell[] => agg(vals.map(v => ({ v })));

    const out: PreviewRow[] = [];
    for (const p of m.people) {
      out.push({ key: `p${p.person_id}`, kind: 'person', label: p.name, personId: p.person_id, cells: agg(p.work) });
      if (!open.has(p.person_id)) continue;
      // projects and steady-state lines in the output's order (the person's planning file, else largest first)
      // (a backend that has not been restarted yet still sends the old projects + ss lists: use them so the preview never goes blank)
      const legacy = p as unknown as { projects?: OutLine[]; ss?: OutLine[] };
      const lines: OutLine[] = p.lines ?? [...(legacy.projects ?? []).map(x => ({ ...x, kind: 'project' as const })), ...(legacy.ss ?? []).map(x => ({ ...x, kind: 'ss' as const }))];
      lines.forEach((ln, i) => out.push(ln.kind === 'ss'
        ? { key: `p${p.person_id}-l${i}`, kind: 'ss', label: ln.label ?? '', sub: 'steady state', cells: agg(ln.vals) }
        : { key: `p${p.person_id}-l${i}`, kind: 'project', label: ln.flex ? (ln.name ?? '') + ' (adjusted)' : (ln.name ?? ''), est: ln.est, prov: ln.prov, cells: agg(ln.vals) }));
    }
    m.summary.forEach((s, i) => out.push({ key: `s${i}`, kind: 'summary', summaryKind: s.kind, label: s.label.trim(), cells: aggNum(s.vals) }));
    return out;
  });

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  ngOnInit() { this.load(true); }

  fmt(v: number): string { return v ? (Math.round(v * 100) / 100).toFixed(2) : '–'; }

  isOpen(personId: number): boolean { return this.open().has(personId); }
  toggleOpen(personId: number) {
    this.open.update(s => { const n = new Set(s); n.has(personId) ? n.delete(personId) : n.add(personId); return n; });
  }
  toggleAll() {
    const m = this.model();
    if (!m) return;
    this.open.set(this.allOpen() ? new Set() : new Set(m.people.map(p => p.person_id)));
  }

  toggleProject(p: OutProject) {
    const m = this.model();
    if (!m) return;
    const off = new Set(m.projects.filter(x => !x.included).map(x => x.project_id));
    p.included ? off.add(p.project_id) : off.delete(p.project_id);
    this.persist([...off]);
  }
  resetExclusions() { this.persist([]); }

  // ── Names and places in the output's list ──
  readonly editing = signal<number | null>(null);
  readonly editName = signal('');
  shownName(p: OutProject): string { return p.output_name || p.name; }
  startEdit(p: OutProject) {
    if (this.editing() === p.project_id) { this.editing.set(null); return; }
    this.editing.set(p.project_id);
    this.editName.set(this.shownName(p));
  }
  /** Rename the project's line, or (not in the list yet) add a new line at the bottom with that name */
  saveName(p: OutProject) {
    const name = this.editName().trim();
    const g = this.model()?.layout?.group_no;
    if (!name || !g) return;
    this.saveLayout(p.entry_id
      ? this.api.renameOutputLayoutEntry(p.entry_id, name, this.auth.user()?.email)
      : this.api.placeOutputLayoutProject({ group_no: g, project_id: p.project_id, new_name: name, by: this.auth.user()?.email }));
  }
  placeAt(p: OutProject, entryId: string) {
    const g = this.model()?.layout?.group_no;
    if (!entryId || !g) return;
    this.saveLayout(this.api.placeOutputLayoutProject({ group_no: g, project_id: p.project_id, entry_id: Number(entryId), by: this.auth.user()?.email }));
  }
  unplace(p: OutProject) {
    const g = this.model()?.layout?.group_no;
    if (!g) return;
    this.saveLayout(this.api.placeOutputLayoutProject({ group_no: g, project_id: p.project_id, by: this.auth.user()?.email }));
  }
  private saveLayout(req: import('rxjs').Observable<unknown>) {
    this.saving.set(true);
    req.subscribe({
      next: () => { this.saving.set(false); this.editing.set(null); this.load(false); },
      error: (e: { error?: { error?: string } }) => { this.saving.set(false); this.error.set(e?.error?.error || 'Could not save the name. Please try again.'); }
    });
  }
  setUseFlex(on: boolean) { this.useFlex.set(on); this.load(false); }

  /** Save the exclusion set (remembered per manager), then rebuild the preview from the same model the download uses. */
  private persist(ids: number[]) {
    this.saving.set(true);
    this.api.saveOutputExclusions(this.manager() || undefined, ids, this.auth.user()?.email).subscribe({
      next: () => { this.saving.set(false); this.load(false); },
      error: () => { this.saving.set(false); this.error.set('Could not save your selection. Please try again.'); }
    });
  }

  private load(first: boolean) {
    if (first) this.loading.set(true);
    this.error.set('');
    this.api.getOutputPreview(this.manager() || undefined, this.format(), this.fromQuarter(), this.toQuarter(), this.includeEstimates(), this.useFlex(), this.layoutFile()).subscribe({
      next: (r: any) => {
        this.model.set(r.data as OutModel);
        this.loading.set(false);
      },
      error: (e: any) => {
        this.loading.set(false);
        this.error.set(e?.status === 404 ? 'No people found for this team, so there is nothing to preview.' : 'Could not build the preview. The backend may need a restart.');
      }
    });
  }
}
