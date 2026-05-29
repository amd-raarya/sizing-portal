import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, MatSelectModule, MatFormFieldModule, MatButtonModule, MatIconModule, MatTabsModule, FormsModule],
  template: `
    <div class="reports-page">
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="report-icon">assessment</mat-icon>
          <div>
            <h2>{{ reportConfig.title }}</h2>
            <p class="subtitle">{{ reportConfig.subtitle }}</p>
          </div>
        </div>
        <div class="header-actions">
          <button mat-stroked-button class="export-btn">
            <mat-icon>table_view</mat-icon> Export to Excel
          </button>
        </div>
      </div>

      <!-- Funding by Project -->
      @if (reportType === 'project') {
        <div class="report-body">
          <div class="summary-bar">
            <div class="summary-tile">
              <span class="tile-label">Total Budget</span>
              <span class="tile-value">$5.6M</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Projects</span>
              <span class="tile-value">12</span>
            </div>
            <div class="summary-tile green">
              <span class="tile-label">Fully Funded</span>
              <span class="tile-value">8</span>
            </div>
            <div class="summary-tile amber">
              <span class="tile-label">Partially Funded</span>
              <span class="tile-value">3</span>
            </div>
            <div class="summary-tile red">
              <span class="tile-label">Not Funded</span>
              <span class="tile-value">1</span>
            </div>
          </div>

          <div class="chart-and-table">
            <div class="chart-panel">
              <h4>Budget by Project (Approved vs Pending)</h4>
              <div class="bar-chart">
                @for (row of projectFundingData; track row.project) {
                  <div class="bar-row">
                    <span class="bar-label">{{ row.project }}</span>
                    <div class="bar-track">
                      <div class="bar-fill approved" [style.width.%]="row.approvedPct">
                        <span *ngIf="row.approvedPct > 15">{{ row.approved }}</span>
                      </div>
                      <div class="bar-fill pending" [style.width.%]="row.pendingPct">
                        <span *ngIf="row.pendingPct > 15">{{ row.pending }}</span>
                      </div>
                    </div>
                    <span class="bar-total">{{ row.total }}</span>
                  </div>
                }
              </div>
              <div class="chart-legend">
                <span class="legend-item"><span class="dot approved-dot"></span> Approved</span>
                <span class="legend-item"><span class="dot pending-dot"></span> Pending</span>
              </div>
            </div>

            <div class="table-panel">
              <h4>Approved Budget by Project</h4>
              <table class="report-table">
                <thead>
                  <tr><th>Project</th><th>Q2 FY26</th><th>Q3 FY26</th><th>Q4 FY26</th><th>Total</th></tr>
                </thead>
                <tbody>
                  @for (row of projectFundingData; track row.project) {
                    <tr>
                      <td class="project-name">{{ row.project }}</td>
                      <td>{{ row.q2 }}</td>
                      <td>{{ row.q3 }}</td>
                      <td>{{ row.q4 }}</td>
                      <td class="total-col">{{ row.total }}</td>
                    </tr>
                  }
                  <tr class="grand-total-row">
                    <td><strong>Grand Total</strong></td>
                    <td><strong>$362K</strong></td>
                    <td><strong>$595K</strong></td>
                    <td><strong>$578K</strong></td>
                    <td><strong>$1.79M</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }

      <!-- Funding by Manager -->
      @if (reportType === 'manager') {
        <div class="report-body">
          <div class="summary-bar">
            <div class="summary-tile">
              <span class="tile-label">Total Projected Cost</span>
              <span class="tile-value">$1.86M</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Managers</span>
              <span class="tile-value">4</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Total Resources</span>
              <span class="tile-value">9</span>
            </div>
          </div>

          <div class="chart-and-table">
            <div class="chart-panel">
              <h4>Projected Cost by Manager</h4>
              <div class="bar-chart">
                @for (mgr of managerData; track mgr.manager) {
                  <div class="bar-row">
                    <span class="bar-label">{{ mgr.manager }}</span>
                    <div class="bar-track">
                      <div class="bar-fill manager-bar" [style.width.%]="mgr.pct" [style.background]="mgr.color">
                        <span *ngIf="mgr.pct > 10">{{ mgr.cost }}</span>
                      </div>
                    </div>
                    <span class="bar-total">{{ mgr.cost }}</span>
                  </div>
                }
              </div>
            </div>

            <div class="table-panel">
              <h4>Cost Breakdown by Manager → Resource</h4>
              <table class="report-table">
                <thead>
                  <tr><th>Manager / Resource</th><th>Projected Cost</th></tr>
                </thead>
                <tbody>
                  @for (mgr of managerData; track mgr.manager) {
                    <tr class="manager-row">
                      <td class="manager-name"><mat-icon class="expand-icon">expand_more</mat-icon>{{ mgr.manager }}</td>
                      <td class="total-col"><strong>{{ mgr.cost }}</strong></td>
                    </tr>
                    @for (res of mgr.resources; track res.name) {
                      <tr class="resource-row">
                        <td class="resource-name">↳ {{ res.name }}</td>
                        <td>{{ res.cost }}</td>
                      </tr>
                    }
                  }
                  <tr class="grand-total-row">
                    <td><strong>Grand Total</strong></td>
                    <td><strong>$1,855,271.83</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }

      <!-- Funding by Director -->
      @if (reportType === 'director') {
        <div class="report-body">
          <div class="summary-bar">
            <div class="summary-tile">
              <span class="tile-label">Total Approved HCs</span>
              <span class="tile-value">46.7</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Q2 FY26</span>
              <span class="tile-value">19.7</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Q3 FY26</span>
              <span class="tile-value">46.7</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Q4 FY26</span>
              <span class="tile-value">44.3</span>
            </div>
          </div>

          <div class="chart-and-table">
            <div class="chart-panel">
              <h4>Approved HCs by Manager — FY26</h4>
              <div class="grouped-chart">
                @for (mgr of directorData; track mgr.name) {
                  <div class="grouped-row">
                    <span class="bar-label">{{ mgr.name }}</span>
                    <div class="grouped-bars">
                      <div class="mini-bar q2-bar" [style.height.px]="mgr.q2 * 4" [title]="'Q2: ' + mgr.q2">
                        <span>{{ mgr.q2 }}</span>
                      </div>
                      <div class="mini-bar q3-bar" [style.height.px]="mgr.q3 * 4" [title]="'Q3: ' + mgr.q3">
                        <span>{{ mgr.q3 }}</span>
                      </div>
                      <div class="mini-bar q4-bar" [style.height.px]="mgr.q4 * 4" [title]="'Q4: ' + mgr.q4">
                        <span>{{ mgr.q4 }}</span>
                      </div>
                    </div>
                  </div>
                }
              </div>
              <div class="chart-legend">
                <span class="legend-item"><span class="dot q2-dot"></span> Q2 FY26</span>
                <span class="legend-item"><span class="dot q3-dot"></span> Q3 FY26</span>
                <span class="legend-item"><span class="dot q4-dot"></span> Q4 FY26</span>
              </div>
            </div>

            <div class="table-panel">
              <h4>Approved HCs for Reference</h4>
              <table class="report-table">
                <thead>
                  <tr><th>Manager</th><th>Q2 FY26</th><th>Q3 FY26</th><th>Q4 FY26</th></tr>
                </thead>
                <tbody>
                  @for (mgr of directorData; track mgr.name) {
                    <tr>
                      <td class="manager-name">{{ mgr.name }}</td>
                      <td>{{ mgr.q2 }}</td>
                      <td>{{ mgr.q3 }}</td>
                      <td>{{ mgr.q4 }}</td>
                    </tr>
                  }
                  <tr class="grand-total-row">
                    <td><strong>Grand Total</strong></td>
                    <td><strong>19.7</strong></td>
                    <td><strong>46.7</strong></td>
                    <td><strong>44.3</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .reports-page { padding: 0; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .report-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }

    .report-body { display: flex; flex-direction: column; gap: 20px; }

    .summary-bar { display: flex; gap: 12px; flex-wrap: wrap; }
    .summary-tile { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px 20px; min-width: 130px; }
    .summary-tile.green { border-left: 4px solid #4caf50; }
    .summary-tile.amber { border-left: 4px solid #ff9800; }
    .summary-tile.red { border-left: 4px solid #ED1C24; }
    .tile-label { display: block; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .tile-value { display: block; font-size: 24px; font-weight: 700; color: #1a1a2e; }

    .chart-and-table { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .chart-panel, .table-panel { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; }
    .chart-panel h4, .table-panel h4 { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: #333; }

    .bar-chart { display: flex; flex-direction: column; gap: 10px; }
    .bar-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
    .bar-label { width: 120px; text-align: right; color: #555; flex-shrink: 0; font-size: 11px; }
    .bar-track { flex: 1; height: 28px; background: #f0f0f0; border-radius: 4px; overflow: hidden; display: flex; }
    .bar-fill { height: 100%; display: flex; align-items: center; padding: 0 8px; font-size: 11px; color: white; font-weight: 600; transition: width 0.3s; }
    .bar-fill.approved { background: #1a1a2e; }
    .bar-fill.pending { background: #90a4ae; }
    .bar-fill.manager-bar { border-radius: 0 4px 4px 0; }
    .bar-total { width: 70px; font-size: 12px; font-weight: 600; color: #333; flex-shrink: 0; }

    .chart-legend { display: flex; gap: 16px; margin-top: 12px; font-size: 12px; color: #666; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .approved-dot { background: #1a1a2e; }
    .pending-dot { background: #90a4ae; }
    .q2-dot { background: #1565c0; }
    .q3-dot { background: #ED1C24; }
    .q4-dot { background: #2e7d32; }

    .grouped-chart { display: flex; gap: 20px; align-items: flex-end; height: 160px; padding: 0 10px; }
    .grouped-row { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
    .bar-label { width: auto; text-align: center; font-size: 11px; color: #555; margin-top: 6px; }
    .grouped-bars { display: flex; gap: 3px; align-items: flex-end; }
    .mini-bar { width: 18px; border-radius: 3px 3px 0 0; display: flex; align-items: flex-start; justify-content: center; padding-top: 3px; font-size: 9px; color: white; font-weight: 600; min-height: 8px; }
    .q2-bar { background: #1565c0; }
    .q3-bar { background: #ED1C24; }
    .q4-bar { background: #2e7d32; }

    .report-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .report-table th { background: #f5f5f5; padding: 8px 12px; text-align: left; font-weight: 600; color: #444; border-bottom: 2px solid #e0e0e0; }
    .report-table td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
    .project-name, .manager-name { font-weight: 500; }
    .manager-row { background: #f8f9ff; }
    .manager-name { display: flex; align-items: center; gap: 4px; font-weight: 600; }
    .expand-icon { font-size: 16px; width: 16px; height: 16px; color: #666; }
    .resource-row td { padding-left: 28px; color: #555; font-size: 12px; }
    .total-col { font-weight: 600; color: #1a1a2e; }
    .grand-total-row { background: #1a1a2e; color: white; }
    .grand-total-row td { color: white; padding: 10px 12px; }
  `]
})
export class ReportsComponent implements OnInit {
  reportType = 'project';
  reportConfig: any = { title: 'Funding by Project', subtitle: '' };

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.data.subscribe(data => {
      this.reportType = data['reportType'] || 'project';
      const configs: any = {
        project: { title: 'Funding by Project', subtitle: 'Approved budget and headcount breakdown by project' },
        manager: { title: 'Funding by Manager', subtitle: 'Projected cost breakdown by reporting manager and their direct reports' },
        director: { title: 'Funding by Director', subtitle: 'Approved headcount rollup by director with manager breakdown' }
      };
      this.reportConfig = configs[this.reportType] || configs.project;
    });
  }

  projectFundingData = [
    { project: 'Project Alpha', q2: '$61K', q3: '$61K', q4: '$61K', total: '$183K', approved: '$183K', pending: '$0', approvedPct: 85, pendingPct: 0 },
    { project: 'Project Beta', q2: '$17K', q3: '$21K', q4: '$26K', total: '$64K', approved: '$64K', pending: '$12K', approvedPct: 60, pendingPct: 10 },
    { project: 'Project Gamma', q2: '$70K', q3: '$70K', q4: '$70K', total: '$210K', approved: '$210K', pending: '$0', approvedPct: 90, pendingPct: 0 },
    { project: 'Project Delta', q2: '$19K', q3: '$714K', q4: '$710K', total: '$1.44M', approved: '$1.44M', pending: '$200K', approvedPct: 75, pendingPct: 15 },
    { project: 'Project Epsilon', q2: '$250K', q3: '$250K', q4: '$250K', total: '$750K', approved: '$750K', pending: '$50K', approvedPct: 80, pendingPct: 10 },
    { project: 'Project Zeta', q2: '$35K', q3: '$35K', q4: '$35K', total: '$105K', approved: '$105K', pending: '$0', approvedPct: 50, pendingPct: 0 },
  ];

  managerData = [
    {
      manager: 'Manager A', cost: '$956,550', pct: 52, color: '#1a1a2e',
      resources: [{ name: 'Resource A1', cost: '$868,985' }, { name: 'Resource A2', cost: '$87,565' }]
    },
    {
      manager: 'Manager B', cost: '$547,153', pct: 30, color: '#ED1C24',
      resources: [{ name: 'Resource B1', cost: '$228,892' }, { name: 'Resource B2', cost: '$74,568' }, { name: 'Resource B3', cost: '$243,692' }]
    },
    {
      manager: 'Manager C', cost: '$81,774', pct: 5, color: '#ff9800',
      resources: [{ name: 'Resource C1', cost: '$45,972' }, { name: 'Resource C2', cost: '$35,802' }]
    },
    {
      manager: 'Manager D', cost: '$269,793', pct: 15, color: '#2e7d32',
      resources: [{ name: 'Resource D1', cost: '$72,193' }, { name: 'Resource D2', cost: '$63,374' }, { name: 'Resource D3', cost: '$134,225' }]
    },
  ];

  directorData = [
    { name: 'Manager A', q2: 0.2, q3: 1.2, q4: 1.2 },
    { name: 'Manager B', q2: 1, q3: 1, q4: 1 },
    { name: 'Manager C', q2: 10.5, q3: 30.5, q4: 29.5 },
    { name: 'Manager D', q2: 3, q3: 3, q4: 2.8 },
    { name: 'Manager E', q2: 3, q3: 4.5, q4: 3.8 },
    { name: 'Manager F', q2: 2, q3: 6, q4: 5.5 },
    { name: 'Manager G', q2: 0.5, q3: 0.5, q4: 0.5 },
  ];
}
