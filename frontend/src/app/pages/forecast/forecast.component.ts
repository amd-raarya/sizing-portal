import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ForecastAccessService } from '../../services/forecast-access.service';
import { HcLineChartComponent, HcPoint } from '../../shared/hc-line-chart/hc-line-chart.component';

interface Bucket { bucket_id: number; code: string; name: string; shape_label: string; typical_peak_hc: number; curve: number[]; curve_source: string; member_count: number; milestones: BucketMilestone[]; shape: BucketShape }
interface BucketShapeCfg {
  start: string; end: string[]; combine: 'average' | 'median'; guideline: number;
  lifecycle: 'stretch' | 'raw'; length: 'median' | 'longest' | number; min_support: number; after_end: 'zero' | 'skip';
}
interface BucketShape extends BucketShapeCfg { learned: { ramp_up_q: number; plateau_q: number; ramp_down_q: number; base: number; end_level: number } | null }
interface BucketMilestone { name: string; offset_q: number; n: number }
interface EstMilestone { milestone_name: string; milestone_date: string }
interface HistoryProject { project_id: number; project_name: string; status: string; bucket_id: number | null; first_quarter: string; last_quarter: string; quarters: number; peak_hc: number; source: 'submitted' | 'draft'; finished: boolean }
interface Stakeholder { manager_name: string; share_pct: number }
interface Estimate {
  forecast_id: number; project_name: string; bucket_id: number; bucket_name: string | null; bucket_code: string | null; complexity: number;
  start_fy: number; start_q: number; duration_q: number | null; milestones: EstMilestone[];
  notes: string | null; status: string; stakeholders: Stakeholder[]; peak: number; total: number; reference_project_id: number | null;
}
interface PreviewQuarter { label: string; fy: number; q: number; total: number; byManager: Record<string, number> }
interface Preview { quarters: PreviewQuarter[]; peak: number; total: number; stakeholders: Stakeholder[]; curve_source: string; bucket: string; warnings: string[] }

type MsGroup = FormGroup<{ name: FormControl<string>; date: FormControl<string> }>;
type ShGroup = FormGroup<{ manager_name: FormControl<string>; share_pct: FormControl<number> }>;

const BUCKET_COLORS: Record<string, string> = { A: '#1565c0', B: '#2e7d32', C: '#e65100', D: '#6a1b9a', E: '#00695c' };
const r1 = (n: number) => Math.round(n * 10) / 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Component({
  selector: 'app-forecast',
  imports: [DecimalPipe, ReactiveFormsModule, RouterLink, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule, HcLineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fc-page">

      <header class="fc-head">
        <div class="fc-head-left">
          <mat-icon class="fc-head-icon">auto_graph</mat-icon>
          <div>
            <h1 class="fc-title">Forecast estimates <span class="fc-pilot">Beta</span></h1>
            <p class="fc-sub">Plan HC for projects that are not sized yet. Pick the closest bucket and a complexity; the numbers are generated, flagged as estimates, and replaced when a real sizing arrives.</p>
          </div>
        </div>
        <div class="fc-seg" role="tablist" aria-label="Forecast sections">
          <button type="button" role="tab" [class.on]="tab() === 'estimate'" [attr.aria-selected]="tab() === 'estimate'" (click)="tab.set('estimate')">
            <mat-icon>add_chart</mat-icon> Estimate a project
          </button>
          <button type="button" role="tab" [class.on]="tab() === 'buckets'" [attr.aria-selected]="tab() === 'buckets'" (click)="openBuckets()">
            <mat-icon>category</mat-icon> Buckets
          </button>
        </div>
      </header>

      @if (denied()) {
        <div class="fc-card fc-denied" role="alert">
          <mat-icon>lock</mat-icon>
          <div><strong>Forecast estimates are not enabled for your account yet.</strong>
            <p>They are available to elevated users. Ask an admin if you should have access.</p></div>
        </div>
      } @else if (loading()) {
        <div class="fc-state"><mat-spinner diameter="32"></mat-spinner><span>Loading…</span></div>
      } @else {

        <!-- ══════════════ ESTIMATE ══════════════ -->
        @if (tab() === 'estimate') {
          <div class="fc-grid">

            <!-- Form -->
            <form class="fc-card fc-form" [formGroup]="form" (ngSubmit)="save()">
              <div class="fc-card-head">
                <h2 class="fc-h2">{{ editingId() ? 'Edit estimate' : 'New estimate' }}</h2>
                @if (editingId()) { <button type="button" class="fc-link" (click)="resetForm()">Start a new one</button> }
              </div>

              <label class="fc-field">
                <span>Project name</span>
                <input class="fc-input" formControlName="project_name" placeholder="e.g. Project X (not released yet)" autocomplete="off">
              </label>

              <fieldset class="fc-field fc-buckets">
                <legend>Closest bucket</legend>
                @for (b of buckets(); track b.bucket_id) {
                  <label class="fc-bucket" [class.on]="form.controls.bucket_id.value === b.bucket_id" [style.--bc]="color(b.code)">
                    <input type="radio" formControlName="bucket_id" [value]="b.bucket_id" (change)="onBucketPicked(b.bucket_id)">
                    <span class="fc-bucket-main">
                      <b>{{ b.code }} · {{ b.name }}</b>
                      <small>{{ b.member_count }} project{{ b.member_count === 1 ? '' : 's' }} · {{ b.shape_label }}</small>
                    </span>
                    <svg class="fc-spark" viewBox="0 0 110 34" aria-hidden="true">
                      <polygon [attr.points]="sparkArea(b.curve)" [attr.fill]="color(b.code)" opacity="0.18" />
                      <polyline [attr.points]="sparkLine(b.curve)" fill="none" [attr.stroke]="color(b.code)" stroke-width="2.2" stroke-linejoin="round" />
                    </svg>
                  </label>
                }
              </fieldset>

              <div class="fc-field">
                <span id="start-label">Starts</span>
                <span class="fc-inline fc-inline--start" role="group" aria-labelledby="start-label">
                  <select class="fc-input" formControlName="start_fy" aria-label="Start fiscal year">
                    @for (fy of fyOptions; track fy) { <option [ngValue]="fy">FY{{ fy % 100 }}</option> }
                  </select>
                  <select class="fc-input" formControlName="start_q" aria-label="Start quarter">
                    @for (q of [1,2,3,4]; track q) { <option [ngValue]="q">Q{{ q }}</option> }
                  </select>
                </span>
              </div>

              <div class="fc-field">
                <label for="dur-input">Duration <small class="fc-muted">(quarters, optional)</small></label>
                <span class="fc-inline">
                  <input id="dur-input" class="fc-input fc-input--num" type="number" min="2" max="40" step="1" formControlName="duration_q"
                    [attr.placeholder]="typicalLength() ? String(typicalLength()) : ''" aria-describedby="dur-hint">
                  @if (form.controls.duration_q.value) {
                    <button type="button" class="fc-link" (click)="form.controls.duration_q.setValue(null)">Use the typical length</button>
                  }
                </span>
                <span id="dur-hint" class="fc-hint">
                  @if (!typicalLength()) { Choose a bucket first. }
                  @else {
                    Typical for this bucket: {{ typicalLength() }} quarters.
                    @if (durationEndLabel(); as endLbl) { The project runs until <b>{{ endLbl }}</b>. }
                    @let dq = durationQ();
                    @if (dq !== null && dq !== typicalLength()) {
                      The whole curve is {{ dq < typicalLength() ? 'squeezed' : 'stretched' }} to fit; the peak HC stays the same, so the total effort {{ dq < typicalLength() ? 'drops' : 'grows' }}.
                    }
                  }
                </span>
              </div>

              <div class="fc-field">
                <span id="cx-label">Complexity <b class="fc-cx">× {{ form.controls.complexity.value | number:'1.2-2' }}</b></span>
                <input type="range" class="fc-range" formControlName="complexity" min="0.25" max="2" step="0.05" aria-labelledby="cx-label">
                <span class="fc-hint">1.00 = a typical project in this bucket. Smaller is lighter, larger is heavier.</span>
              </div>

              <!-- Milestones: each date pins that point of the bucket's curve, so the curve is shifted in time -->
              <div class="fc-field">
                <span id="ms-label">Milestones <small class="fc-muted">(optional — shift the curve in time)</small></span>
                @if (!form.controls.bucket_id.value) {
                  <span class="fc-hint">Choose a bucket first — its past projects tell us where each milestone usually falls.</span>
                } @else if (!(selectedBucket()?.milestones?.length)) {
                  <span class="fc-hint">This bucket's past projects have no milestone dates yet, so the curve cannot be shifted. Add milestones to them in the sizing screen and re-learn the bucket.</span>
                } @else {
                  <div formArrayName="milestones" class="fc-ms" aria-labelledby="ms-label">
                    @for (g of milestones.controls; track g; let i = $index) {
                      <div class="fc-ms-row" [formGroupName]="i">
                        <span class="fc-ms-name">{{ g.controls.name.value }}</span>
                        <input class="fc-input" type="date" formControlName="date" [attr.aria-label]="g.controls.name.value + ' date'">
                        <button type="button" class="fc-x" (click)="removeMilestone(i)" [attr.aria-label]="'Remove ' + g.controls.name.value"><mat-icon>close</mat-icon></button>
                        <small class="fc-hint fc-ms-typ">Typically {{ typicalLabel(g.controls.name.value) }}</small>
                      </div>
                    }
                  </div>
                  @if (availableMilestones().length) {
                    <div class="fc-sh-add">
                      <select class="fc-input" #addMs aria-label="Add a milestone">
                        <option value="">Add a milestone…</option>
                        @for (m of availableMilestones(); track m.name) { <option [value]="m.name">{{ m.name }} — typically {{ typicalLabel(m.name) }}</option> }
                      </select>
                      <button type="button" class="fc-btn fc-btn--ghost" (click)="addMilestone(addMs.value); addMs.value = ''">Add</button>
                    </div>
                  }
                  <span class="fc-hint">Each date moves that point of the curve; the phases in between stretch or squeeze to fit. A longer phase keeps its HC for longer, so it costs more effort.</span>
                }
              </div>

              <!-- Managers: automatic from the bucket's past projects; editable only on request -->
              <div class="fc-field">
                <span>Managers <small class="fc-muted">(share of the HC)</small></span>
                @if (!customManagers()) {
                  @if (stakeholders.length) {
                    <ul class="fc-auto" aria-label="Managers picked automatically">
                      @for (g of stakeholders.controls; track g) {
                        <li><span class="fc-sh-name">{{ g.controls.manager_name.value }}</span><b>{{ g.controls.share_pct.value | number:'1.0-0' }}%</b></li>
                      }
                    </ul>
                    <span class="fc-hint">{{ suggestNote() || 'Picked automatically from the bucket.' }}
                      <button type="button" class="fc-link" (click)="customManagers.set(true)">Adjust managers</button></span>
                  } @else {
                    <span class="fc-hint">{{ form.controls.bucket_id.value ? 'This bucket has no manager history yet.' : 'Choose a bucket — its managers are picked automatically.' }}
                      @if (form.controls.bucket_id.value) { <button type="button" class="fc-link" (click)="customManagers.set(true)">Add managers</button> }</span>
                  }
                } @else {
                  <div formArrayName="stakeholders" class="fc-sh">
                    @for (g of stakeholders.controls; track g; let i = $index) {
                      <div class="fc-sh-row" [formGroupName]="i">
                        <span class="fc-sh-name">{{ g.controls.manager_name.value }}</span>
                        <input class="fc-input fc-input--sm" type="number" min="0" max="100" step="1" formControlName="share_pct" (change)="onShareChange(i)" [attr.aria-label]="'Share for ' + g.controls.manager_name.value">
                        <span class="fc-muted">%</span>
                        <button type="button" class="fc-x" (click)="removeManager(i)" [attr.aria-label]="'Remove ' + g.controls.manager_name.value"><mat-icon>close</mat-icon></button>
                      </div>
                    }
                  </div>
                  <div class="fc-sh-add">
                    <select class="fc-input" #addSel aria-label="Add a manager">
                      <option value="">Add a manager…</option>
                      @for (m of availableManagers(); track m) { <option [value]="m">{{ m }}</option> }
                    </select>
                    <button type="button" class="fc-btn fc-btn--ghost" (click)="addManager(addSel.value); addSel.value = ''">Add</button>
                  </div>
                  <span class="fc-hint" [class.fc-warn]="shareTotal() !== 100">Shares always add up to 100%: change one and the others adjust.
                    <button type="button" class="fc-link" (click)="useAutoManagers()">Back to automatic</button></span>
                }
              </div>

              <label class="fc-field">
                <span>Notes (optional)</span>
                <textarea class="fc-input" rows="2" formControlName="notes" placeholder="Why this bucket? Source of the date?"></textarea>
              </label>

              @if (formError()) { <div class="fc-error" role="alert">{{ formError() }}</div> }

              <div class="fc-actions">
                <button type="submit" class="fc-btn fc-btn--primary" [disabled]="saving()">
                  <mat-icon>save</mat-icon> {{ editingId() ? 'Save changes' : 'Add to Assignment Output' }}
                </button>
              </div>
            </form>

            <!-- Preview -->
            <div class="fc-right">
              <section class="fc-card">
                <div class="fc-card-head">
                  <div>
                    <h2 class="fc-h2">Generated HC <span class="fc-tag">ESTIMATE</span></h2>
                    <p class="fc-card-sub">Updates as you change the form. Nothing is saved until you add it.</p>
                  </div>
                </div>
                @if (preview(); as p) {
                  <div class="fc-kpis">
                    <div class="fc-kpi"><small>Peak</small><b>{{ p.peak | number:'1.1-1' }} HC</b></div>
                    <div class="fc-kpi"><small>Total effort</small><b>{{ p.total | number:'1.0-1' }} HC-qtrs</b></div>
                    <div class="fc-kpi"><small>Quarters</small><b>{{ p.quarters.length }}</b></div>
                  </div>
                  @if (p.warnings.length) {
                    <ul class="fc-warnlist" role="status">
                      @for (w of p.warnings; track w) { <li>{{ w }}</li> }
                    </ul>
                  }
                  <app-hc-line-chart [points]="chartPoints()" [height]="200" color="#e65100" />
                  <div class="fc-scroll">
                    <table class="fc-table">
                      <thead>
                        <tr>
                          <th scope="col">Manager</th>
                          @for (q of p.quarters; track q.label) { <th scope="col" class="fc-num">{{ q.label }}</th> }
                        </tr>
                      </thead>
                      <tbody>
                        @for (s of p.stakeholders; track s.manager_name) {
                          <tr>
                            <th scope="row">{{ s.manager_name }} <small class="fc-muted">{{ s.share_pct | number:'1.0-0' }}%</small></th>
                            @for (q of p.quarters; track q.label) { <td class="fc-num fc-est">{{ cell(q, s.manager_name) }}</td> }
                          </tr>
                        }
                        <tr class="fc-total">
                          <th scope="row">Total</th>
                          @for (q of p.quarters; track q.label) { <td class="fc-num">{{ q.total | number:'1.1-1' }}</td> }
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p class="fc-hint">Curve source: <strong>{{ p.curve_source === 'template' ? 'starter template (to be replaced by learned curves)' : p.curve_source }}</strong>. Nothing else to do: people are picked automatically. If people are ticked Yes in the <a routerLink="/allocation" class="fc-a">Eligibility Matrix</a>, the estimate goes to them only and follows their free room (shared between the estimates they are ticked on; cut when they are short, larger when they have more). With no ticks: people who usually work on this bucket's projects, then anyone with spare capacity; HC nobody can take shows as hiring gap.</p>
                } @else {
                  <div class="fc-empty">
                    <mat-icon>insights</mat-icon>
                    <span>{{ previewHint() }}</span>
                  </div>
                }
              </section>
            </div>
          </div>

          <!-- Existing estimates -->
          <section class="fc-card fc-card--flush">
            <div class="fc-card-head fc-pad">
              <div>
                <h2 class="fc-h2">Your estimates</h2>
                <p class="fc-card-sub">Open estimates count towards the hiring gap and appear (hatched) in the Assignment Output.</p>
              </div>
            </div>
            @if (estimates().length === 0) {
              <div class="fc-empty fc-pad"><mat-icon>inbox</mat-icon><span>No estimates yet.</span></div>
            } @else {
              <div class="fc-scroll">
                <table class="fc-table fc-table--list">
                  <thead><tr>
                    <th scope="col">Project</th><th scope="col">Bucket</th><th scope="col">Starts</th><th scope="col" class="fc-num">Complexity</th>
                    <th scope="col" class="fc-num">Peak HC</th><th scope="col">Managers</th><th scope="col">Status</th><th scope="col"><span class="fc-sr">Actions</span></th>
                  </tr></thead>
                  <tbody>
                    @for (e of estimates(); track e.forecast_id) {
                      <tr>
                        <th scope="row">{{ e.project_name }}</th>
                        <td><span class="fc-chip" [style.--bc]="color(e.bucket_code)">{{ e.bucket_code }} · {{ e.bucket_name }}</span></td>
                        <td>Q{{ e.start_q }} FY{{ e.start_fy % 100 }}</td>
                        <td class="fc-num">× {{ e.complexity | number:'1.2-2' }}</td>
                        <td class="fc-num">{{ e.peak | number:'1.1-1' }}</td>
                        <td class="fc-wrap">{{ managersText(e) }}</td>
                        <td>
                          @if (e.status === 'open') { <span class="fc-tag">ESTIMATE</span> }
                          @else if (e.status === 'promoted') { <span class="fc-tag fc-tag--ok">LINKED</span> }
                        </td>
                        <td class="fc-acts">
                          @if (e.status === 'open') {
                            <button type="button" class="fc-link" (click)="edit(e)">Edit</button>
                            <button type="button" class="fc-link" (click)="startLink(e)">Link to real project</button>
                            <button type="button" class="fc-link fc-link--danger" (click)="cancel(e)">Cancel</button>
                          }
                        </td>
                      </tr>
                      @if (linkingId() === e.forecast_id) {
                        <tr class="fc-linkrow">
                          <td colspan="8">
                            <div class="fc-linkbox">
                              <span>The real project now exists. Link it — the estimate stops counting and the real sizing takes over:</span>
                              <select class="fc-input" #lp aria-label="Real project">
                                <option value="">Choose a project…</option>
                                @for (p of realProjects(); track p.project_id) { <option [value]="p.project_id">{{ p.project_name }}</option> }
                              </select>
                              <button type="button" class="fc-btn fc-btn--primary" (click)="confirmLink(e, lp.value)">Link</button>
                              <button type="button" class="fc-btn fc-btn--ghost" (click)="linkingId.set(null)">Not now</button>
                            </div>
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }

        <!-- ══════════════ BUCKETS ══════════════ -->
        @if (tab() === 'buckets') {
          <section class="fc-bgrid" aria-label="Buckets">
            @for (b of buckets(); track b.bucket_id) {
              <article class="fc-card fc-bcard" [style.--bc]="color(b.code)">
                <div class="fc-bcard-head">
                  <span class="fc-bcode">{{ b.code }}</span>
                  <div>
                    <h2 class="fc-h2">{{ b.name }}</h2>
                    <small class="fc-muted">{{ b.shape_label }}</small>
                  </div>
                </div>
                <svg class="fc-curve" viewBox="0 0 110 34" preserveAspectRatio="none" role="img"
                  [attr.aria-label]="'Curve of bucket ' + b.name + (shapePreview()[b.bucket_id] ? ', with a dashed line showing the new curve' : '')">
                  <polygon [attr.points]="sparkArea(b.curve, curveLen(b))" [attr.fill]="color(b.code)" opacity="0.18" />
                  <polyline [attr.points]="sparkLine(b.curve, curveLen(b))" fill="none" [attr.stroke]="color(b.code)" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
                  @if (shapePreview()[b.bucket_id]; as pv) {
                    <polyline [attr.points]="sparkLine(pv.curve, curveLen(b))" fill="none" stroke="#1a2332" stroke-width="1.6" stroke-dasharray="4 3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
                  }
                </svg>
                <dl class="fc-bstats">
                  <div><dt>Projects</dt><dd>{{ b.member_count }}</dd></div>
                  <div><dt>Typical peak</dt><dd>{{ b.typical_peak_hc | number:'1.0-1' }} HC</dd></div>
                  <div><dt>Length</dt><dd>{{ b.curve.length }} quarters</dd></div>
                  <div><dt>Curve</dt><dd>{{ b.curve_source === 'template' ? 'Starter' : 'Learned' }}</dd></div>
                </dl>
                <div class="fc-members">
                  <small class="fc-muted">Learned from</small>
                  @for (m of membersOf(b.bucket_id); track m.project_id) {
                    <span class="fc-chip" [style.--bc]="color(b.code)">{{ m.project_name }}@if (m.source === 'draft') { <em> · draft</em> }</span>
                  } @empty {
                    <span class="fc-hint">No projects placed yet.</span>
                  }
                </div>
                <div class="fc-shape" role="group" [attr.aria-label]="'Project lengths for ' + b.name">
                  <small class="fc-muted fc-full">Projects have different lengths. How are they put on one curve?</small>
                  <span class="fc-inline" role="radiogroup" [attr.aria-label]="'Lifecycle handling for ' + b.name">
                    <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-checked]="shapeOf(b).lifecycle === 'stretch'" [attr.aria-pressed]="shapeOf(b).lifecycle === 'stretch'" (click)="setLifecycle(b, 'stretch')">Stretch every project to one length</button>
                    <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-checked]="shapeOf(b).lifecycle === 'raw'" [attr.aria-pressed]="shapeOf(b).lifecycle === 'raw'" (click)="setLifecycle(b, 'raw')">Real quarters</button>
                  </span>
                  @if (shapeOf(b).lifecycle === 'stretch') {
                    <span class="fc-hint">Each project's ramp-up, peak and ramp-down is squeezed or stretched to the same length, so short and long projects count equally across the whole curve.</span>
                    <span class="fc-inline" role="radiogroup" [attr.aria-label]="'Common length for ' + b.name">
                      <span class="fc-hint"><b>Common length</b></span>
                      <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-checked]="shapeOf(b).length === 'median'" [attr.aria-pressed]="shapeOf(b).length === 'median'" (click)="setLength(b, 'median')">Typical (median project)</button>
                      <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-checked]="shapeOf(b).length === 'longest'" [attr.aria-pressed]="shapeOf(b).length === 'longest'" (click)="setLength(b, 'longest')">Longest project</button>
                      <label class="fc-hint" [attr.for]="'len-' + b.bucket_id">or</label>
                      <input class="fc-input fc-input--num" type="number" min="2" max="40" step="1" [id]="'len-' + b.bucket_id" placeholder="quarters"
                        [value]="isNumber(shapeOf(b).length) ? shapeOf(b).length : ''" (change)="setLength(b, $any($event.target).value)">
                    </span>
                  } @else {
                    <span class="fc-hint">Projects keep their real quarters. A project that has finished counts as 0 HC afterwards; the curve is cut where too few projects are still running.</span>
                    <span class="fc-inline">
                      <label class="fc-hint" [attr.for]="'ms-' + b.bucket_id"><b>Cut the tail when fewer than</b></label>
                      <input class="fc-input fc-input--num" type="number" min="1" max="20" step="1" [id]="'ms-' + b.bucket_id" [value]="shapeOf(b).min_support" (change)="setMinSupport(b, $any($event.target).value)">
                      <span class="fc-hint">projects are still running</span>
                    </span>
                    <span class="fc-inline" role="radiogroup" [attr.aria-label]="'Finished projects in ' + b.name">
                      <span class="fc-hint"><b>After a project ends</b></span>
                      <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-checked]="shapeOf(b).after_end === 'zero'" [attr.aria-pressed]="shapeOf(b).after_end === 'zero'" (click)="setAfterEnd(b, 'zero')">Counts as 0 HC</button>
                      <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-checked]="shapeOf(b).after_end === 'skip'" [attr.aria-pressed]="shapeOf(b).after_end === 'skip'" (click)="setAfterEnd(b, 'skip')">Left out of the average</button>
                    </span>
                  }
                  @if (shapeChanged(b) && !b.milestones.length) {
                    <p class="fc-hint" role="status">
                      @if (shapePreview()[b.bucket_id]; as pv) { Dashed line = the new curve ({{ pv.curve.length }} quarters). } @else { Checking… }
                    </p>
                    <div class="fc-actions">
                      <button type="button" class="fc-btn fc-btn--primary" [disabled]="learning() === b.bucket_id" (click)="applyShape(b)">Apply and re-learn</button>
                      <button type="button" class="fc-btn fc-btn--ghost" (click)="resetShape(b)">Cancel</button>
                    </div>
                  }
                </div>
                @if (b.milestones.length) {
                  <div class="fc-shape" role="group" [attr.aria-label]="'Curve shape for ' + b.name">
                    <small class="fc-muted fc-full">How the curve is built (set per bucket, change any time)</small>
                    <small class="fc-muted fc-full">Line the projects up on (the first one a project has is used; click in the order you want):</small>
                    <div class="fc-chips">
                      @for (m of b.milestones; track m.name) {
                        <button type="button" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-pressed]="endIndex(b, m.name) >= 0"
                          [disabled]="m.name === shapeOf(b).start" [attr.title]="m.n < 2 ? 'Only one project has this milestone' : null" (click)="toggleEnd(b, m.name)">
                          @if (endIndex(b, m.name) >= 0) { {{ endIndex(b, m.name) + 1 }}. }{{ m.name }} <em>· {{ m.n }}</em>
                        </button>
                      }
                    </div>
                    <span class="fc-hint">Projects with none of these are not dropped: they are combined on their own start.</span>
                    <div class="fc-blend" role="radiogroup" [attr.aria-label]="'How to combine the projects in ' + b.name">
                      <span class="fc-hint"><b>Combine the lined-up projects by</b></span>
                      <span class="fc-inline">
                        <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-pressed]="shapeOf(b).combine === 'average'" [attr.aria-checked]="shapeOf(b).combine === 'average'" (click)="setCombine(b, 'average')">Average</button>
                        <button type="button" role="radio" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-pressed]="shapeOf(b).combine === 'median'" [attr.aria-checked]="shapeOf(b).combine === 'median'" (click)="setCombine(b, 'median')">Median</button>
                      </span>
                    </div>
                    <div class="fc-blend">
                      <label [attr.for]="'gl-' + b.bucket_id"><b>{{ 100 - shapeOf(b).guideline * 100 | number:'1.0-0' }}% real projects</b> + <b>{{ shapeOf(b).guideline * 100 | number:'1.0-0' }}% guideline</b></label>
                      <input type="range" class="fc-range" [id]="'gl-' + b.bucket_id" min="0" max="100" step="5" [value]="shapeOf(b).guideline * 100"
                        [attr.aria-valuetext]="shapeOf(b).guideline * 100 + ' percent guideline'" (change)="setGuideline(b, $any($event.target).value)">
                      <span class="fc-hint">Guideline = ramp up until the milestone below, hold the peak until the milestone above, ramp down.</span>
                    </div>
                    <small class="fc-muted fc-full">Guideline ramp-up ends at:</small>
                    <div class="fc-chips">
                      @for (m of b.milestones; track m.name) {
                        <button type="button" class="fc-chip fc-chip--btn" [style.--bc]="color(b.code)" [attr.aria-pressed]="shapeOf(b).start === m.name"
                          [attr.title]="m.n < 2 ? 'Only one project has this milestone' : null" (click)="setStart(b, m.name)">
                          {{ m.name }} <em>· {{ m.n }}</em>
                        </button>
                      }
                    </div>
                    @if (b.shape.learned && !shapeChanged(b)) {
                      <p class="fc-hint">Guideline measured: ramp up {{ b.shape.learned.ramp_up_q | number:'1.1-1' }} quarters, hold {{ b.shape.learned.plateau_q | number:'1.1-1' }}, ramp down {{ b.shape.learned.ramp_down_q | number:'1.1-1' }}.</p>
                    }
                  </div>
                  @if (shapeChanged(b)) {
                    <p class="fc-hint" role="status">
                      @if (shapePreview()[b.bucket_id]; as pv) {
                        Dashed line = the new curve.
                        @for (n of pv.notes; track n) { <span class="fc-warn">{{ n }} </span> }
                      } @else { Checking…  }
                    </p>
                    <div class="fc-actions">
                      <button type="button" class="fc-btn fc-btn--primary" [disabled]="learning() === b.bucket_id" (click)="applyShape(b)">Apply and re-learn</button>
                      <button type="button" class="fc-btn fc-btn--ghost" (click)="resetShape(b)">Cancel</button>
                    </div>
                  }
                }
                @if (b.curve_source === 'template') {
                  <p class="fc-hint">Starter shape. Place projects in this bucket below, then re-learn the curve.</p>
                }
                @if (stale().has(b.bucket_id)) {
                  <p class="fc-hint fc-warn">Members changed — the curve is out of date.</p>
                }
                <button type="button" class="fc-btn" [class.fc-btn--primary]="stale().has(b.bucket_id)" [class.fc-btn--ghost]="!stale().has(b.bucket_id)"
                  [disabled]="learning() === b.bucket_id || !membersOf(b.bucket_id).length" (click)="relearn(b)">
                  <mat-icon>auto_fix_high</mat-icon> {{ learning() === b.bucket_id ? 'Learning…' : 'Re-learn curve' }}
                </button>
              </article>
            }
          </section>

          <section class="fc-card fc-card--flush">
            <div class="fc-card-head fc-pad">
              <div>
                <h2 class="fc-h2">Projects → buckets</h2>
                <p class="fc-card-sub">Every project with sizing HC. Place each one in its closest bucket, then re-learn that bucket's curve. {{ assignedCount() }} of {{ history().length }} placed.</p>
              </div>
              <div class="fc-tools">
                <input class="fc-input" type="search" placeholder="Search projects…" [value]="search()" (input)="search.set($any($event.target).value)" aria-label="Search projects">
                <label class="fc-check"><input type="checkbox" [checked]="onlyUnplaced()" (change)="onlyUnplaced.set($any($event.target).checked)"> Not placed yet</label>
              </div>
            </div>
            <div class="fc-scroll fc-scroll--tall">
              <table class="fc-table fc-table--list">
                <thead><tr>
                  <th scope="col">Project</th><th scope="col">Data range</th><th scope="col" class="fc-num">Quarters</th>
                  <th scope="col" class="fc-num">Peak HC</th><th scope="col">Data from</th><th scope="col">Bucket</th>
                </tr></thead>
                <tbody>
                  @for (h of visibleHistory(); track h.project_id) {
                    <tr>
                      <th scope="row">{{ h.project_name }}</th>
                      <td>{{ h.first_quarter }} → {{ h.last_quarter }} @if (!h.finished) { <span class="fc-chip fc-chip--run">running</span> }</td>
                      <td class="fc-num">{{ h.quarters }}</td>
                      <td class="fc-num">{{ h.peak_hc | number:'1.1-1' }}</td>
                      <td>{{ h.source === 'submitted' ? 'Submitted sizing' : 'Draft sizing' }}</td>
                      <td>
                        <select class="fc-input" [value]="h.bucket_id ?? ''" (change)="setBucket(h, $any($event.target).value)" [attr.aria-label]="'Bucket for ' + h.project_name">
                          <option value="">— not placed —</option>
                          @for (b of buckets(); track b.bucket_id) { <option [value]="b.bucket_id">{{ b.code }} · {{ b.name }}</option> }
                        </select>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="fc-empty-cell">No projects match.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fc-page { display: flex; flex-direction: column; gap: 16px; }
    .fc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .fc-head-left { display: flex; align-items: center; gap: 12px; max-width: 780px; }
    .fc-head-icon { color: #e65100; font-size: 30px; width: 30px; height: 30px; flex-shrink: 0; }
    .fc-title { font-size: 22px; font-weight: 800; color: #1a1a2e; margin: 0; }
    .fc-pilot { font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; background: #fff3e0; color: #8a2f00; border: 1px dashed #e65100; border-radius: 10px; padding: 2px 8px; vertical-align: middle; margin-left: 6px; }
    .fc-sub { font-size: 12px; color: #5d6b7e; margin: 2px 0 0; line-height: 1.4; }
    .fc-seg { display: inline-flex; border: 1px solid #d8dee8; border-radius: 9px; overflow: hidden; background: #fff; }
    .fc-seg button { display: inline-flex; align-items: center; gap: 5px; border: none; background: none; padding: 0 14px; height: 36px; font-size: 12px; font-weight: 600; color: #4a5a6e; cursor: pointer; font-family: inherit; }
    .fc-seg button mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .fc-seg button:hover:not(.on) { background: #f3f6fb; }
    .fc-seg button.on { background: #1565c0; color: #fff; }
    :is(.fc-seg button, .fc-btn, .fc-link, .fc-x, .fc-input, .fc-range):focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }

    .fc-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 60px; color: #5d6b7e; background: #fff; border: 1px solid #e6e9ef; border-radius: 12px; }
    .fc-denied { display: flex; gap: 14px; align-items: center; color: #4a5a6e; }
    .fc-denied mat-icon { font-size: 32px; width: 32px; height: 32px; color: #8a94a6; }
    .fc-denied p { margin: 2px 0 0; font-size: 12px; }

    .fc-card { background: #fff; border: 1px solid #e6e9ef; border-radius: 12px; padding: 16px 18px; }
    .fc-card--flush { padding: 0; overflow: hidden; }
    .fc-pad { padding: 14px 18px; }
    .fc-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .fc-card-head.fc-pad { margin-bottom: 0; }
    .fc-h2 { font-size: 15px; font-weight: 700; color: #1a1a2e; margin: 0; }
    .fc-card-sub { font-size: 12px; color: #5d6b7e; margin: 3px 0 0; line-height: 1.4; max-width: 720px; }
    .fc-tag { display: inline-block; font-size: 9.5px; font-weight: 800; letter-spacing: 0.4px; color: #8a2f00; background: #ffe0b2; border: 1px dashed #e65100; border-radius: 8px; padding: 0 7px; margin-left: 6px; vertical-align: middle; }
    .fc-tag--ok { color: #1b5e20; background: #e8f5e9; border: 1px solid #a5d6a7; }

    .fc-grid { display: grid; grid-template-columns: minmax(380px, 460px) 1fr; gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .fc-grid { grid-template-columns: 1fr; } }
    .fc-form { display: flex; flex-direction: column; gap: 14px; }
    .fc-right { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .fc-field { display: flex; flex-direction: column; gap: 4px; border: none; padding: 0; margin: 0; min-width: 0; }
    .fc-field > span, .fc-field > legend { font-size: 11px; font-weight: 700; color: #4a5a6e; text-transform: uppercase; letter-spacing: 0.4px; padding: 0; }
    .fc-field small { text-transform: none; letter-spacing: 0; font-weight: 500; }
    .fc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .fc-inline { display: flex; gap: 6px; }
    .fc-input { height: 36px; border: 1px solid #c9d1dd; border-radius: 8px; padding: 0 10px; font-size: 13px; font-family: inherit; background: #fff; color: #1a1a2e; min-width: 0; }
    textarea.fc-input { height: auto; padding: 8px 10px; resize: vertical; }
    .fc-input--num { width: 90px; }
    .fc-input--sm { width: 90px; }
    .fc-range { width: 100%; accent-color: #e65100; }
    .fc-cx { color: #e65100; margin-left: 6px; text-transform: none; font-size: 13px; }
    .fc-hint { font-size: 11.5px; color: #5d6b7e; line-height: 1.4; text-transform: none; letter-spacing: 0; font-weight: 400; }
    .fc-warn { color: #8a4b00; font-weight: 700; }
    .fc-muted { color: #5d6b7e; }
    .fc-error { background: #ffebee; color: #b71c1c; border: 1px solid #ef9a9a; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; }

    .fc-buckets { gap: 6px; }
    .fc-bucket { display: flex; align-items: center; gap: 10px; border: 1px solid #dcdfe3; background: #fff; border-radius: 8px; padding: 7px 10px; cursor: pointer; }
    .fc-bucket:hover { background: #f8fafc; }
    .fc-bucket.on { border: 2px solid var(--bc); padding: 6px 9px; background: color-mix(in srgb, var(--bc) 8%, #fff); }
    .fc-bucket:has(input:focus-visible) { outline: 2px solid #1565c0; outline-offset: 2px; }
    .fc-bucket input { accent-color: var(--bc); width: 16px; height: 16px; flex-shrink: 0; }
    .fc-bucket-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .fc-bucket-main b { color: var(--bc); font-size: 13px; text-transform: none; letter-spacing: 0; }
    .fc-bucket-main small { color: #5d6b7e; font-size: 11px; font-weight: 500; text-transform: none; letter-spacing: 0; }
    .fc-spark { width: 90px; height: 30px; flex-shrink: 0; }

    .fc-auto { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .fc-auto li { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 5px 10px; background: #f6f8fb; border-radius: 6px; }
    .fc-auto b { margin-left: auto; color: #1a1a2e; font-variant-numeric: tabular-nums; }
    .fc-sh { display: flex; flex-direction: column; gap: 5px; }
    .fc-inline--start { max-width: 220px; }
    .fc-ms { display: flex; flex-direction: column; gap: 8px; }
    .fc-ms-row { display: grid; grid-template-columns: 110px 1fr auto; gap: 4px 8px; align-items: center; }
    .fc-ms-name { font-weight: 700; color: #1a2332; }
    .fc-ms-typ { grid-column: 2 / 4; margin-top: -2px; }
    .fc-warnlist { margin: 0 0 8px; padding: 8px 12px 8px 28px; background: #fff6e5; border: 1px solid #f0c36a; border-radius: 8px; color: #6b4200; font-size: 12px; }
    .fc-sh-row { display: flex; align-items: center; gap: 8px; }
    .fc-sh-name { flex: 1; font-size: 13px; color: #1a1a2e; font-weight: 600; text-transform: none; letter-spacing: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fc-sh-add { display: flex; gap: 8px; }
    .fc-sh-add .fc-input { flex: 1; }
    .fc-x { border: none; background: none; cursor: pointer; color: #5d6b7e; border-radius: 6px; padding: 2px; display: flex; }
    .fc-x:hover { background: #f1f3f7; color: #b71c1c; }
    .fc-x mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .fc-actions { display: flex; gap: 10px; margin-top: 2px; }
    .fc-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; border: 1px solid transparent; }
    .fc-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .fc-btn--primary { background: #1565c0; color: #fff; }
    .fc-btn--primary:disabled { background: #9bb8dc; cursor: default; }
    .fc-btn--ghost { background: #fff; border-color: #d8dee8; color: #1a1a2e; }
    .fc-link { border: none; background: none; color: #0d47a1; font-weight: 700; font-size: 12px; cursor: pointer; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
    .fc-link:hover { text-decoration: underline; }
    .fc-link--danger { color: #b71c1c; }
    .fc-a { color: #0d47a1; font-weight: 700; }

    .fc-kpis { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .fc-kpi { border: 1px solid #e6e9ef; border-left: 4px solid #e65100; border-radius: 8px; padding: 8px 14px; min-width: 120px; }
    .fc-kpi small { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #5d6b7e; }
    .fc-kpi b { font-size: 20px; color: #1a1a2e; }
    .fc-empty { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 36px 20px; color: #5d6b7e; font-size: 13px; }
    .fc-empty-cell { text-align: center; color: #5d6b7e; padding: 24px; }

    .fc-scroll { overflow-x: auto; margin-top: 8px; }
    .fc-scroll--tall { max-height: 520px; overflow-y: auto; margin-top: 0; }
    .fc-card--flush .fc-scroll { margin-top: 10px; }
    .fc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .fc-table th, .fc-table td { padding: 7px 10px; border-bottom: 1px solid #f0f2f6; text-align: left; white-space: nowrap; }
    .fc-table thead th { font-size: 10.5px; font-weight: 700; color: #5d6b7e; text-transform: uppercase; letter-spacing: 0.4px; background: #fafbfc; position: sticky; top: 0; }
    .fc-table tbody th { font-weight: 700; color: #1a1a2e; }
    .fc-num { text-align: right !important; font-variant-numeric: tabular-nums; }
    .fc-wrap { white-space: normal !important; max-width: 280px; }
    .fc-est { background: repeating-linear-gradient(45deg, #fff3e0, #fff3e0 5px, #ffe9cc 5px, #ffe9cc 10px); color: #7a2e00; }
    .fc-total th, .fc-total td { font-weight: 800; background: #eef2f7; }
    .fc-acts { white-space: nowrap; }
    .fc-chip { display: inline-block; border-radius: 12px; padding: 2px 10px; font-size: 11.5px; font-weight: 700; color: var(--bc, #455a64); background: color-mix(in srgb, var(--bc, #455a64) 12%, #fff); }
    .fc-chip--btn { border: 1px solid color-mix(in srgb, var(--bc, #455a64) 35%, #fff); cursor: pointer; font-family: inherit; }
    .fc-chip--btn[aria-pressed='true'] { background: var(--bc, #455a64); color: #fff; }
    .fc-chip--btn:disabled { opacity: 0.55; cursor: default; }
    .fc-chip--btn:focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }
    .fc-full { flex-basis: 100%; }
    .fc-shape { display: flex; flex-direction: column; gap: 6px; }
    .fc-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .fc-blend { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px solid #d8dee8; border-radius: 8px; background: #fff; }
    .fc-chip--run { --bc: #1565c0; margin-left: 6px; font-size: 10.5px; padding: 0 8px; }
    .fc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .fc-linkrow td { background: #fff8e1; }
    .fc-linkbox { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: #5d4300; white-space: normal; }
    .fc-linkbox .fc-input { min-width: 240px; }

    .fc-bgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .fc-bcard { border-top: 4px solid var(--bc); display: flex; flex-direction: column; gap: 8px; }
    .fc-bcard-head { display: flex; align-items: center; gap: 10px; }
    .fc-bcode { width: 34px; height: 34px; border-radius: 50%; background: var(--bc); color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .fc-curve { width: 100%; height: 60px; }
    .fc-bstats { display: flex; gap: 14px; margin: 0; }
    .fc-bstats dt { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #5d6b7e; }
    .fc-bstats dd { margin: 0; font-size: 14px; font-weight: 800; color: #1a1a2e; }
    .fc-members { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
    .fc-members em { font-style: normal; font-weight: 500; opacity: 0.8; }
    .fc-bcard .fc-btn { align-self: flex-start; margin-top: 4px; }
    .fc-tools { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .fc-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #4a5a6e; cursor: pointer; }
  `]
})
export class ForecastComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private access = inject(ForecastAccessService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  readonly tab = signal<'estimate' | 'buckets'>('estimate');
  readonly loading = signal(true);
  readonly denied = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');

  readonly buckets = signal<Bucket[]>([]);
  readonly estimates = signal<Estimate[]>([]);
  readonly managers = signal<string[]>([]);
  readonly realProjects = signal<{ project_id: number; project_name: string }[]>([]);
  readonly history = signal<HistoryProject[]>([]);
  private historyLoaded = false;

  readonly preview = signal<Preview | null>(null);
  readonly previewHint = signal('Choose a bucket to see the generated HC.');
  readonly suggestNote = signal('');
  readonly customManagers = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly linkingId = signal<number | null>(null);

  readonly stale = signal<Set<number>>(new Set());
  readonly learning = signal<number | null>(null);
  readonly search = signal('');
  readonly onlyUnplaced = signal(false);

  readonly fyOptions: number[] = (() => { const y = new Date().getFullYear(); return Array.from({ length: 9 }, (_, i) => y - 1 + i); })();

  readonly form = this.fb.group({
    project_name: this.fb.nonNullable.control('', Validators.required),
    bucket_id: this.fb.control<number | null>(null, Validators.required),
    start_fy: this.fb.nonNullable.control(new Date().getFullYear()),
    start_q: this.fb.nonNullable.control(Math.ceil((new Date().getMonth() + 1) / 3)),
    duration_q: this.fb.control<number | null>(null),
    complexity: this.fb.nonNullable.control(1),
    notes: this.fb.nonNullable.control(''),
    stakeholders: new FormArray<ShGroup>([]),
    milestones: new FormArray<MsGroup>([])
  });
  get stakeholders(): FormArray<ShGroup> { return this.form.controls.stakeholders; }
  get milestones(): FormArray<MsGroup> { return this.form.controls.milestones; }
  private newMilestone(name: string, date: string): MsGroup {
    return new FormGroup({ name: new FormControl(name, { nonNullable: true }), date: new FormControl(date, { nonNullable: true }) });
  }
  private newStakeholder(name: string, share: number): ShGroup {
    return new FormGroup({ manager_name: new FormControl(name, { nonNullable: true }), share_pct: new FormControl(share, { nonNullable: true }) });
  }

  readonly selectedBucket = signal<Bucket | null>(null);
  readonly shareTotal = signal(0);
  readonly availableManagers = signal<string[]>([]);
  readonly availableMilestones = signal<BucketMilestone[]>([]);
  readonly startCoord = signal(0);   // start of the chosen start quarter on the same quarter axis the server uses
  readonly durationQ = signal<number | null>(null);
  /** quarters the chosen bucket's curve normally runs */
  readonly typicalLength = computed(() => this.selectedBucket()?.curve.length ?? 0);
  /** last quarter of the project, e.g. "Q3 FY29", from the start and the duration (or the typical length) */
  readonly durationEndLabel = computed(() => {
    const len = this.durationQ() ?? this.typicalLength();
    if (!len || len < 1) return '';
    const key = this.startCoord() + len;           // the quarter key of the last quarter
    return `Q${((key - 1) % 4) + 1} FY${Math.floor((key - 1) / 4) % 100}`;
  });
  readonly String = String;

  readonly chartPoints = computed<HcPoint[]>(() => (this.preview()?.quarters ?? []).map(q => ({ label: q.label, value: q.total, kind: 'forecast' as const })));
  readonly assignedCount = computed(() => this.history().filter(h => h.bucket_id).length);
  readonly visibleHistory = computed(() => {
    const s = this.search().trim().toLowerCase();
    return this.history().filter(h => (!s || h.project_name.toLowerCase().includes(s)) && (!this.onlyUnplaced() || !h.bucket_id));
  });

  constructor() {
    // Live preview: nothing is saved
    this.form.valueChanges.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshDerived(true));
  }

  ngOnInit() {
    this.access.refresh();
    const email = this.auth.user()?.email || '';
    this.api.getForecastAccess(email).subscribe({
      next: (r: any) => {
        if (!r?.data?.allowed) { this.denied.set(true); this.loading.set(false); return; }
        this.loadAll();
      },
      error: () => { this.denied.set(true); this.loading.set(false); }
    });
  }

  private loadAll() {
    let pending = 4;
    const done = () => { if (--pending === 0) this.loading.set(false); };
    this.api.getForecastBuckets().subscribe({ next: (r: any) => { this.buckets.set(r.data || []); done(); }, error: () => { this.denied.set(true); done(); } });
    this.api.getForecastProjects().subscribe({ next: (r: any) => { this.estimates.set(r.data || []); done(); }, error: () => done() });
    this.api.getForecastManagers().subscribe({ next: (r: any) => { this.managers.set((r.data || []).map((m: any) => m.manager_name)); this.refreshDerived(false); done(); }, error: () => done() });
    this.api.getProjects().subscribe({
      next: (r: any) => { this.realProjects.set((r.data || []).filter((p: any) => !p.is_test).map((p: any) => ({ project_id: p.project_id, project_name: p.project_name })).sort((a: any, b: any) => a.project_name.localeCompare(b.project_name))); done(); },
      error: () => done()
    });
  }

  color(code: string | null | undefined): string { return BUCKET_COLORS[code || ''] || '#455a64'; }

  // ── Sparkline helpers (12-quarter curve, 110×34) ──
  sparkLine(curve: number[], len?: number): string { return this.sparkPts(curve, len).join(' '); }
  sparkArea(curve: number[], len?: number): string { return `3,30 ${this.sparkPts(curve, len).join(' ')} ${(3 + (104 * (curve.length - 1)) / Math.max((len ?? curve.length) - 1, 1)).toFixed(1)},30`; }
  private sparkPts(curve: number[], len?: number): string[] {
    const n = Math.max((len ?? curve.length) - 1, 1);
    return curve.map((v, i) => `${(3 + (104 * i) / n).toFixed(1)},${(30 - 24 * Math.min(Math.max(v, 0), 1)).toFixed(1)}`);
  }

  // ── Form ──
  onBucketPicked(bucketId: number) {
    this.selectedBucket.set(this.buckets().find(b => b.bucket_id === bucketId) ?? null);
    this.milestones.clear();   // milestones belong to the bucket they were picked for
    this.refreshDerived(false);
    if (this.customManagers() && this.stakeholders.length) return;   // never overwrite what the user adjusted
    this.api.suggestForecastStakeholders(bucketId).subscribe({
      next: (r: any) => {
        const d = r.data || {};
        this.stakeholders.clear();
        (d.managers || []).forEach((m: Stakeholder) => this.stakeholders.push(this.newStakeholder(m.manager_name, m.share_pct)));
        this.suggestNote.set(d.managers?.length
          ? `Based on the ${d.projects_used} past project${d.projects_used === 1 ? '' : 's'} in this bucket.`
          : '');
        this.refreshDerived(true);
      },
      error: () => this.suggestNote.set('')
    });
  }

  addManager(name: string) {
    if (!name) return;
    this.customManagers.set(true);
    this.stakeholders.push(this.newStakeholder(name, this.stakeholders.length ? 0 : 100));
    this.refreshDerived(true);
  }
  useAutoManagers() {
    this.customManagers.set(false);
    const id = this.form.controls.bucket_id.value;
    this.stakeholders.clear();
    if (id) this.onBucketPicked(id); else this.refreshDerived(true);
  }
  removeManager(i: number) {
    this.customManagers.set(true);
    this.stakeholders.removeAt(i);
    this.rebalance(-1);
    this.refreshDerived(true);
  }
  /** A share was typed: that manager keeps what was typed, the others share what is left in the proportions they had */
  onShareChange(i: number) {
    this.rebalance(i);
    this.refreshDerived(true);
  }
  private rebalance(keep: number) {
    const ctrls = this.stakeholders.controls.map(g => g.controls.share_pct);
    if (!ctrls.length) return;
    if (ctrls.length === 1) { ctrls[0].setValue(100, { emitEvent: false }); return; }
    const vals = ctrls.map(c => Math.max(0, Number(c.value) || 0));
    const fixed = keep >= 0 ? Math.min(100, vals[keep]) : 0;
    const others = vals.map((v, j) => (j === keep ? 0 : v));
    const rest = 100 - fixed, sumOthers = others.reduce((a, b) => a + b, 0);
    const out = vals.map((v, j) => {
      if (j === keep) return fixed;
      if (keep < 0 && sumOthers <= 0) return 100 / ctrls.length;
      return sumOthers > 0 ? (others[j] / sumOthers) * rest : (ctrls.length > 1 ? rest / (ctrls.length - (keep >= 0 ? 1 : 0)) : 0);
    }).map(v => Math.round(v * 10) / 10);
    // rounding can leave 99.9 or 100.1: put the difference on the biggest share that was not typed
    const diff = Math.round((100 - out.reduce((a, b) => a + b, 0)) * 10) / 10;
    if (diff !== 0) {
      let big = -1;
      out.forEach((v, j) => { if (j !== keep && (big < 0 || v > out[big])) big = j; });
      if (big >= 0) out[big] = Math.round((out[big] + diff) * 10) / 10;
    }
    ctrls.forEach((c, j) => c.setValue(out[j], { emitEvent: false }));
  }

  // ── Milestones ──
  /** Date at a point of the quarter axis (the server's: 4 quarters a year, a quarter = 3 months of 30 days) */
  private dateAt(coord: number): { y: number; m: number; d: number } {
    const y = Math.floor(coord / 4);
    const months = (coord - y * 4) * 3;
    const m = Math.min(11, Math.floor(months + 1e-9));
    return { y, m, d: Math.min(28, Math.round((months - m) * 30) + 1) };
  }
  typicalLabel(name: string): string {
    const ms = this.selectedBucket()?.milestones.find(x => x.name === name);
    if (!ms) return '—';
    const t = this.dateAt(this.startCoord() + ms.offset_q);
    return `${MONTHS[t.m]} ${t.y}`;
  }
  addMilestone(name: string) {
    const ms = this.selectedBucket()?.milestones.find(x => x.name === name);
    if (!ms) return;
    const t = this.dateAt(this.startCoord() + ms.offset_q);
    this.milestones.push(this.newMilestone(name, `${t.y}-${String(t.m + 1).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`));
    this.refreshDerived(true);
  }
  removeMilestone(i: number) {
    this.milestones.removeAt(i);
    this.refreshDerived(true);
  }

  private refreshDerived(runPreview: boolean) {
    this.startCoord.set(Number(this.form.controls.start_fy.value) * 4 + Number(this.form.controls.start_q.value) - 1);
    const dq = Number(this.form.controls.duration_q.value);
    this.durationQ.set(Number.isFinite(dq) && dq >= 2 ? Math.round(dq) : null);
    const usedMs = new Set(this.milestones.controls.map(g => g.controls.name.value));
    this.availableMilestones.set((this.selectedBucket()?.milestones ?? []).filter(m => !usedMs.has(m.name)));
    const sh = this.stakeholders.controls.map(g => g.getRawValue());
    this.shareTotal.set(r1(sh.reduce((s, x) => s + (Number(x.share_pct) || 0), 0)));
    const used = new Set(sh.map(x => x.manager_name));
    this.availableManagers.set(this.managers().filter(m => !used.has(m)));
    if (!runPreview) return;
    const body = this.payload();
    if (!body.bucket_id) { this.preview.set(null); this.previewHint.set('Choose a bucket to see the generated HC.'); return; }
    if (this.customManagers() && !body.stakeholders.length) { this.preview.set(null); this.previewHint.set('Add at least one manager with a share.'); return; }
    this.api.previewForecast(body).subscribe({
      next: (r: any) => { this.preview.set(r.data); },
      error: (e: any) => { this.preview.set(null); this.previewHint.set(e?.error?.error || 'Could not generate a preview.'); }
    });
  }

  private payload() {
    const v = this.form.getRawValue();
    return {
      project_name: v.project_name.trim(),
      bucket_id: v.bucket_id,
      complexity: Number(v.complexity),
      start_fy: Number(v.start_fy), start_q: Number(v.start_q),
      duration_q: v.duration_q && Number(v.duration_q) >= 2 ? Math.round(Number(v.duration_q)) : null,
      milestones: v.milestones.filter(m => m.name && m.date).map(m => ({ milestone_name: m.name, milestone_date: m.date })),
      notes: v.notes.trim() || null,
      // automatic mode sends none: the server uses the bucket's managers and shares
      stakeholders: this.customManagers() ? v.stakeholders.filter(s => s.manager_name && Number(s.share_pct) > 0).map(s => ({ manager_name: s.manager_name, share_pct: Number(s.share_pct) })) : []
    };
  }

  save() {
    this.formError.set('');
    const body = this.payload();
    if (!body.project_name) { this.formError.set('Give the project a name.'); return; }
    if (!body.bucket_id) { this.formError.set('Choose the closest bucket.'); return; }
    if (this.customManagers() && !body.stakeholders.length) { this.formError.set('Add at least one manager with a share, or go back to automatic.'); return; }
    this.saving.set(true);
    const id = this.editingId();
    const req = id ? this.api.updateForecastProject(id, body) : this.api.createForecastProject(body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.snack.open(id ? 'Estimate updated' : 'Estimate added — it now appears in the Assignment Output and counts towards the gap', 'Close', { duration: 4000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.resetForm();
        this.reloadEstimates();
      },
      error: (e: any) => { this.saving.set(false); this.formError.set(e?.error?.error || 'Could not save the estimate.'); }
    });
  }

  resetForm() {
    this.editingId.set(null);
    this.customManagers.set(false);
    this.stakeholders.clear();
    this.milestones.clear();
    this.form.reset({
      project_name: '', bucket_id: null, start_fy: new Date().getFullYear(), start_q: Math.ceil((new Date().getMonth() + 1) / 3),
      duration_q: null, complexity: 1, notes: ''
    });
    this.selectedBucket.set(null);
    this.suggestNote.set('');
    this.preview.set(null);
    this.previewHint.set('Choose a bucket to see the generated HC.');
    this.refreshDerived(false);
  }

  edit(e: Estimate) {
    this.editingId.set(e.forecast_id);
    this.customManagers.set(true);   // keep exactly what was saved
    this.stakeholders.clear();
    e.stakeholders.forEach(s => this.stakeholders.push(this.newStakeholder(s.manager_name, Number(s.share_pct))));
    this.milestones.clear();
    (e.milestones ?? []).forEach(m => this.milestones.push(this.newMilestone(m.milestone_name, m.milestone_date)));
    this.form.patchValue({
      project_name: e.project_name, bucket_id: e.bucket_id, start_fy: e.start_fy, start_q: e.start_q, duration_q: e.duration_q ?? null,
      complexity: Number(e.complexity), notes: e.notes ?? ''
    });
    this.selectedBucket.set(this.buckets().find(b => b.bucket_id === e.bucket_id) ?? null);
    this.suggestNote.set('');
    this.refreshDerived(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancel(e: Estimate) {
    if (!confirm(`Cancel the estimate for "${e.project_name}"? It stops counting everywhere (it is kept for history).`)) return;
    this.api.cancelForecastProject(e.forecast_id).subscribe({
      next: () => { if (this.editingId() === e.forecast_id) this.resetForm(); this.reloadEstimates(); },
      error: () => this.snack.open('Could not cancel the estimate', 'Close', { duration: 3500 })
    });
  }

  startLink(e: Estimate) { this.linkingId.set(this.linkingId() === e.forecast_id ? null : e.forecast_id); }
  confirmLink(e: Estimate, projectId: string) {
    if (!projectId) { this.snack.open('Choose the real project first', 'Close', { duration: 3000 }); return; }
    this.api.promoteForecastProject(e.forecast_id, Number(projectId)).subscribe({
      next: () => { this.linkingId.set(null); this.snack.open('Linked — the real sizing now takes over', 'Close', { duration: 3500 }); this.reloadEstimates(); },
      error: (err: any) => this.snack.open(err?.error?.error || 'Could not link the project', 'Close', { duration: 4000 })
    });
  }

  private reloadEstimates() {
    this.api.getForecastProjects().subscribe({ next: (r: any) => this.estimates.set(r.data || []) });
  }

  cell(q: PreviewQuarter, manager: string): string {
    const v = q.byManager[manager];
    return v ? (Math.round(v * 100) / 100).toFixed(2) : '–';
  }
  managersText(e: Estimate): string {
    return e.stakeholders.map(s => `${s.manager_name} ${Math.round(Number(s.share_pct))}%`).join(' · ');
  }

  // ── Buckets tab ──
  openBuckets() {
    this.tab.set('buckets');
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    this.api.getForecastHistoryProjects().subscribe({
      next: (r: any) => this.history.set(r.data || []),
      error: () => { this.historyLoaded = false; this.snack.open('Could not load past projects', 'Close', { duration: 3500 }); }
    });
  }

  membersOf(bucketId: number): HistoryProject[] { return this.history().filter(h => h.bucket_id === bucketId); }

  relearn(b: Bucket) {
    this.learning.set(b.bucket_id);
    this.api.relearnForecastBucket(b.bucket_id).subscribe({
      next: () => {
        this.learning.set(null);
        this.stale.update(s => { const n = new Set(s); n.delete(b.bucket_id); return n; });
        this.api.getForecastBuckets().subscribe({ next: (r: any) => this.buckets.set(r.data || []) });
        this.snack.open(`${b.name}: curve re-learned`, 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
      },
      error: (e: any) => { this.learning.set(null); this.snack.open(e?.error?.error || 'Could not re-learn the curve', 'Close', { duration: 4000 }); }
    });
  }

  // ── Curve shape (Buckets tab) ──
  readonly shapeDraft = signal<Record<number, BucketShapeCfg>>({});
  readonly shapePreview = signal<Record<number, { curve: number[]; notes: string[] }>>({});
  /** one scale for the saved curve and the preview, so their lengths compare honestly */
  curveLen(b: Bucket): number { return Math.max(b.curve.length, this.shapePreview()[b.bucket_id]?.curve.length ?? 0); }
  shapeOf(b: Bucket): BucketShapeCfg {
    const s = b.shape;
    return this.shapeDraft()[b.bucket_id] ?? {
      start: s.start, end: s.end, combine: s.combine, guideline: s.guideline,
      lifecycle: s.lifecycle ?? 'stretch', length: s.length ?? 'median', min_support: s.min_support ?? 3, after_end: s.after_end ?? 'zero'
    };
  }
  isNumber(v: unknown): v is number { return typeof v === 'number'; }
  endIndex(b: Bucket, name: string): number { return this.shapeOf(b).end.indexOf(name); }
  shapeChanged(b: Bucket): boolean {
    const a = this.shapeOf(b), s = b.shape;
    return Math.abs(a.guideline - s.guideline) > 0.001 || a.combine !== s.combine || a.start !== s.start || a.end.join('|') !== s.end.join('|')
      || a.lifecycle !== (s.lifecycle ?? 'stretch') || a.length !== (s.length ?? 'median') || a.min_support !== (s.min_support ?? 3) || a.after_end !== (s.after_end ?? 'zero');
  }
  setLifecycle(b: Bucket, lifecycle: 'stretch' | 'raw') { this.changeShape(b, { ...this.shapeOf(b), lifecycle }); }
  setLength(b: Bucket, value: 'median' | 'longest' | string) {
    if (value === 'median' || value === 'longest') { this.changeShape(b, { ...this.shapeOf(b), length: value }); return; }
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n >= 2 && n <= 40) this.changeShape(b, { ...this.shapeOf(b), length: n });
  }
  setMinSupport(b: Bucket, value: string) {
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n >= 1 && n <= 20) this.changeShape(b, { ...this.shapeOf(b), min_support: n });
  }
  setAfterEnd(b: Bucket, after_end: 'zero' | 'skip') { this.changeShape(b, { ...this.shapeOf(b), after_end }); }
  setCombine(b: Bucket, combine: 'average' | 'median') { this.changeShape(b, { ...this.shapeOf(b), combine }); }
  setGuideline(b: Bucket, pct: string) { this.changeShape(b, { ...this.shapeOf(b), guideline: Math.min(100, Math.max(0, Number(pct))) / 100 }); }
  setStart(b: Bucket, name: string) {
    const cur = this.shapeOf(b);
    this.changeShape(b, { ...cur, start: cur.start === name ? '' : name, end: cur.end.filter(x => x !== name) });
  }
  toggleEnd(b: Bucket, name: string) {
    const cur = this.shapeOf(b);
    this.changeShape(b, { ...cur, end: cur.end.includes(name) ? cur.end.filter(x => x !== name) : [...cur.end, name] });
  }
  private changeShape(b: Bucket, next: BucketShapeCfg) {
    this.shapeDraft.update(d => ({ ...d, [b.bucket_id]: next }));
    if (!this.shapeChanged(b)) { this.clearShapeDraft(b.bucket_id); return; }
    this.shapePreview.update(p => { const n = { ...p }; delete n[b.bucket_id]; return n; });
    const key = JSON.stringify(next);
    this.api.previewForecastBucketLearn(b.bucket_id, next).subscribe({
      next: (r: any) => {
        if (JSON.stringify(this.shapeDraft()[b.bucket_id]) !== key) return;   // a newer click has replaced this one
        this.shapePreview.update(p => ({ ...p, [b.bucket_id]: { curve: r.data?.curve ?? [], notes: r.data?.notes ?? [] } }));
      },
      error: () => this.snack.open('Could not preview the curve', 'Close', { duration: 3500 })
    });
  }
  resetShape(b: Bucket) { this.clearShapeDraft(b.bucket_id); }
  private clearShapeDraft(id: number) {
    this.shapeDraft.update(d => { const n = { ...d }; delete n[id]; return n; });
    this.shapePreview.update(p => { const n = { ...p }; delete n[id]; return n; });
  }
  applyShape(b: Bucket) {
    const shape = this.shapeOf(b);
    this.learning.set(b.bucket_id);
    this.api.saveForecastBucketShape(b.bucket_id, shape).subscribe({
      next: () => {
        this.learning.set(null);
        this.clearShapeDraft(b.bucket_id);
        this.relearn(b);
      },
      error: () => { this.learning.set(null); this.snack.open('Could not save the curve shape', 'Close', { duration: 3500 }); }
    });
  }

  setBucket(h: HistoryProject, value: string) {
    const bucketId = value ? Number(value) : null;
    const before = h.bucket_id;
    this.history.update(list => list.map(x => x.project_id === h.project_id ? { ...x, bucket_id: bucketId } : x));
    this.api.setForecastBucketMember(h.project_id, bucketId).subscribe({
      next: () => {
        // both the old and the new bucket now have different members
        this.stale.update(s => { const n = new Set(s); if (before) n.add(before); if (bucketId) n.add(bucketId); return n; });
        this.api.getForecastBuckets().subscribe({ next: (r: any) => this.buckets.set(r.data || []) });
      },
      error: () => {
        this.history.update(list => list.map(x => x.project_id === h.project_id ? { ...x, bucket_id: before } : x));
        this.snack.open('Could not save the bucket', 'Close', { duration: 3500 });
      }
    });
  }
}
