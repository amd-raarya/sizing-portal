import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';
import { ProjectsComponent } from './pages/projects/projects.component';
import { SizingComponent } from './pages/sizing/sizing.component';
import { ViewsComponent } from './pages/views/views.component';
import { ReportsComponent } from './pages/reports/reports.component';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: ProjectsComponent },
      { path: 'sizing/:projectId', component: SizingComponent },
      { path: 'views/sizing', component: ViewsComponent, data: { viewType: 'sizing' } },
      { path: 'views/gap', component: ViewsComponent, data: { viewType: 'gap' } },
      { path: 'views/allocation', component: ViewsComponent, data: { viewType: 'allocation' } },
      { path: 'reports/funding-project', component: ReportsComponent, data: { reportType: 'project' } },
      { path: 'reports/funding-manager', component: ReportsComponent, data: { reportType: 'manager' } },
      { path: 'reports/funding-director', component: ReportsComponent, data: { reportType: 'director' } },
    ]
  }
];
