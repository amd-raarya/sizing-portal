import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-views',
  standalone: true,
  imports: [CommonModule, MatSelectModule, MatFormFieldModule, MatButtonModule, MatIconModule, FormsModule],
  template: `
    <div class="views-page">
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="view-icon">{{ viewConfig.icon }}</mat-icon>
          <div>
            <h2>{{ viewConfig.title }}</h2>
            <p class="subtitle">{{ viewConfig.subtitle }}</p>
          </div>
        </div>
        <div class="header-actions">
          <button mat-stroked-button class="export-btn">
            <mat-icon>download</mat-icon> Export
          </button>
          <button mat-stroked-button class="refresh-btn">
            <mat-icon>refresh</mat-icon> Refresh
          </button>
        </div>
      </div>

      <!-- Slicer bar -->
      <div class="slicer-bar">
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>BU</mat-label>
          <mat-select [(ngModel)]="filters.bu">
            <mat-option value="">All</mat-option>
            <mat-option value="Embedded">Embedded</mat-option>
            <mat-option value="Compute">Compute</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>Project</mat-label>
          <mat-select [(ngModel)]="filters.project">
            <mat-option value="">All Projects</mat-option>
            <mat-option value="eris">Eris v2.0</mat-option>
            <mat-option value="android">Android EAP v1.3</mat-option>
            <mat-option value="ecarx">ECARX SW Tools CCB</mat-option>
            <mat-option value="krk1">KRK1 New Features v1.0</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>FY / Quarter</mat-label>
          <mat-select [(ngModel)]="filters.fy">
            <mat-option value="">All</mat-option>
            <mat-option value="fy26">FY26</mat-option>
            <mat-option value="fy27">FY27</mat-option>
            <mat-option value="fy28">FY28</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>HC Type</mat-label>
          <mat-select [(ngModel)]="filters.hcType">
            <mat-option value="">All</mat-option>
            <mat-option value="fte">Existing - FTE</mat-option>
            <mat-option value="cont">Incremental - CONT</mat-option>
            <mat-option value="xchg">Incremental - XCHG</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="filters.location">
            <mat-option value="">All</mat-option>
            <mat-option value="canada">Canada</mat-option>
            <mat-option value="india">India</mat-option>
            <mat-option value="china">China</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field" *ngIf="viewType === 'sizing'">
          <mat-label>Version Status</mat-label>
          <mat-select [(ngModel)]="filters.status">
            <mat-option value="">All</mat-option>
            <mat-option value="draft">Draft</mat-option>
            <mat-option value="submitted">Submitted</mat-option>
            <mat-option value="bu_approved">BU Approved</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <!-- View content -->
      @if (viewType === 'sizing') {
        <div class="pbi-container">
          <div class="pbi-label">
            <mat-icon>bar_chart</mat-icon>
            Power BI — Sizing View
            <span class="live-badge">LIVE DATA</span>
          </div>
          <img src="powerbi-sizing.png" alt="Sizing View" class="pbi-screenshot" />
        </div>
      }

      @if (viewType === 'gap') {
        <div class="placeholder-view gap-view">
          <div class="placeholder-header">
            <mat-icon>compare_arrows</mat-icon>
            <div>
              <h3>Gap Analysis View</h3>
              <p>Compares sized headcount vs allocated headcount per project, location and quarter.</p>
            </div>
          </div>
          <div class="gap-sample">
            <div class="gap-row header-row">
              <span>Project</span><span>Location</span><span>Quarter</span>
              <span>Sized HC</span><span>Allocated HC</span><span>Gap</span><span>Status</span>
            </div>
            @for (row of gapSampleData; track row.project) {
              <div class="gap-row" [class.understaffed]="row.status === 'UNDERSTAFFED'" [class.staffed]="row.status === 'FULLY STAFFED'" [class.overstaffed]="row.status === 'OVERSTAFFED'">
                <span>{{ row.project }}</span>
                <span>{{ row.location }}</span>
                <span>{{ row.quarter }}</span>
                <span>{{ row.sized }}</span>
                <span>{{ row.allocated }}</span>
                <span class="gap-val">{{ row.gap > 0 ? '+' : '' }}{{ row.gap }}</span>
                <span class="status-chip gap-{{ row.status === 'UNDERSTAFFED' ? 'under' : row.status === 'OVERSTAFFED' ? 'over' : 'ok' }}">{{ row.status }}</span>
              </div>
            }
          </div>
          <div class="phase-badge">Phase 2 — Full Power BI embed coming</div>
        </div>
      }

      @if (viewType === 'allocation') {
        <div class="placeholder-view alloc-view">
          <div class="placeholder-header">
            <mat-icon>people</mat-icon>
            <div>
              <h3>Allocation View</h3>
              <p>Shows named headcount assignments per project per month. Who is allocated, at what percentage, and at what cost.</p>
            </div>
          </div>
          <div class="alloc-sample">
            <div class="alloc-row header-row">
              <span>Project</span><span>Person</span><span>Role</span>
              <span>Q2 FY26</span><span>Q3 FY26</span><span>Q4 FY26</span><span>Q1 FY27</span><span>Cost</span>
            </div>
            @for (row of allocSampleData; track row.person) {
              <div class="alloc-row">
                <span>{{ row.project }}</span>
                <span class="person-name">{{ row.person }}</span>
                <span class="role-tag">{{ row.role }}</span>
                <span>{{ row.q2 || '—' }}</span>
                <span>{{ row.q3 || '—' }}</span>
                <span>{{ row.q4 || '—' }}</span>
                <span>{{ row.q1fy27 || '—' }}</span>
                <span class="cost-val">{{ row.cost }}</span>
              </div>
            }
          </div>
          <div class="phase-badge">Phase 2 — Full Power BI embed coming</div>
        </div>
      }
    </div>
  `,
  styles: [`
    .views-page { padding: 0; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .view-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }
    .header-actions { display: flex; gap: 8px; }
    .export-btn, .refresh-btn { font-size: 13px; }

    .slicer-bar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; background: #f8f9fa; padding: 12px 16px; border-radius: 8px; border: 1px solid #e8e8e8; }
    .slicer-field { width: 160px; }
    .slicer-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    .pbi-container { background: white; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
    .pbi-label { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #1a1a2e; color: white; font-size: 13px; font-weight: 500; }
    .live-badge { background: #ED1C24; color: white; font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
    .pbi-screenshot { width: 100%; display: block; }

    .placeholder-view { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; }
    .placeholder-header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee; }
    .placeholder-header mat-icon { font-size: 40px; width: 40px; height: 40px; color: #ED1C24; margin-top: 4px; }
    .placeholder-header h3 { margin: 0 0 4px; font-size: 18px; }
    .placeholder-header p { margin: 0; color: #666; font-size: 13px; }

    .gap-sample, .alloc-sample { font-size: 13px; }
    .gap-row, .alloc-row { display: grid; padding: 8px 12px; border-bottom: 1px solid #f0f0f0; align-items: center; }
    .gap-row { grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr 1.5fr; }
    .alloc-row { grid-template-columns: 1.5fr 1.5fr 1fr 1fr 1fr 1fr 1fr 1fr; }
    .header-row { background: #f5f5f5; font-weight: 600; color: #444; border-radius: 6px 6px 0 0; }
    .understaffed { background: #fff3f3; }
    .staffed { background: #f3fff6; }
    .overstaffed { background: #fff8f0; }
    .gap-val { font-weight: 600; }
    .status-chip { padding: 3px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-align: center; }
    .gap-under { background: #ffebee; color: #c62828; }
    .gap-ok { background: #e8f5e9; color: #2e7d32; }
    .gap-over { background: #fff3e0; color: #e65100; }
    .person-name { font-weight: 500; }
    .role-tag { color: #666; font-size: 12px; }
    .cost-val { font-weight: 600; color: #1a1a2e; }

    .phase-badge { margin-top: 20px; text-align: center; color: #999; font-size: 12px; font-style: italic; padding: 12px; background: #f8f9fa; border-radius: 6px; }
  `]
})
export class ViewsComponent {
  viewType = 'sizing';
  filters: any = { bu: '', project: '', fy: '', hcType: '', location: '', status: '' };

  viewConfig: any = {
    sizing: { title: 'Sizing View', subtitle: 'Headcount sizing submissions by project, version, and quarter', icon: 'table_chart' },
    gap: { title: 'Gap Analysis View', subtitle: 'Sized vs allocated headcount — identify understaffed projects', icon: 'compare_arrows' },
    allocation: { title: 'Allocation View', subtitle: 'Named headcount assignments per project and month', icon: 'people' }
  }['sizing'];

  constructor(private route: ActivatedRoute) {
    this.route.data.subscribe(data => {
      this.viewType = data['viewType'] || 'sizing';
      this.viewConfig = {
        sizing: { title: 'Sizing View', subtitle: 'Headcount sizing submissions by project, version, and quarter', icon: 'table_chart' },
        gap: { title: 'Gap Analysis View', subtitle: 'Sized vs allocated headcount — identify understaffed projects', icon: 'compare_arrows' },
        allocation: { title: 'Allocation View', subtitle: 'Named headcount assignments per project and month', icon: 'people' }
      }[this.viewType] || this.viewConfig;
    });
  }

  gapSampleData = [
    { project: 'Project Alpha', location: 'Canada', quarter: 'Q2 FY26', sized: 3.0, allocated: 2.5, gap: -0.5, status: 'UNDERSTAFFED' },
    { project: 'Project Beta', location: 'India Bangalore', quarter: 'Q2 FY26', sized: 5.0, allocated: 5.0, gap: 0, status: 'FULLY STAFFED' },
    { project: 'Project Gamma', location: 'China Shanghai', quarter: 'Q3 FY26', sized: 2.0, allocated: 2.5, gap: 0.5, status: 'OVERSTAFFED' },
    { project: 'Project Delta', location: 'India Hyderabad', quarter: 'Q3 FY26', sized: 8.0, allocated: 5.0, gap: -3.0, status: 'UNDERSTAFFED' },
    { project: 'Project Alpha', location: 'Canada', quarter: 'Q4 FY26', sized: 4.0, allocated: 4.0, gap: 0, status: 'FULLY STAFFED' },
  ];

  allocSampleData = [
    { project: 'Project Alpha', person: 'Engineer A', role: 'SW Engineer', q2: 1.0, q3: 1.0, q4: 1.0, q1fy27: 1.0, cost: '$120,000' },
    { project: 'Project Alpha', person: 'Engineer B', role: 'SW Engineer', q2: 0.5, q3: 1.0, q4: 1.0, q1fy27: null, cost: '$87,500' },
    { project: 'Project Beta', person: 'Engineer C', role: 'Architect', q2: 1.0, q3: 1.0, q4: null, q1fy27: null, cost: '$95,000' },
    { project: 'Project Beta', person: 'Engineer D', role: 'SW Engineer', q2: null, q3: 0.5, q4: 1.0, q1fy27: 1.0, cost: '$67,500' },
    { project: 'Project Gamma', person: 'Engineer E', role: 'PMO', q2: 1.0, q3: 1.0, q4: 1.0, q1fy27: 1.0, cost: '$110,000' },
  ];
}
