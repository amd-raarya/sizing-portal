import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';
import { ProjectsComponent } from './pages/projects/projects.component';
import { SizingComponent } from './pages/sizing/sizing.component';
import { ViewsComponent } from './pages/views/views.component';
import { ReportsComponent } from './pages/reports/reports.component';
import { GanttComponent } from './pages/gantt/gantt.component';
import { AdminComponent } from './pages/admin/admin.component';
import { LoginComponent } from './pages/login/login.component';
import { AllocationComponent } from './pages/allocation/allocation.component';
import { authGuard, elevatedGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: ProjectsComponent },
      { path: 'sizing/:projectId', component: SizingComponent },
      { path: 'views/sizing', component: ViewsComponent, data: { viewType: 'sizing' } },
      { path: 'views/gap', component: ViewsComponent, data: { viewType: 'gap' } },
      { path: 'views/allocation', component: ViewsComponent, data: { viewType: 'allocation' } },
      { path: 'views/gantt', component: GanttComponent },
      { path: 'reports/funding-project', component: ReportsComponent, canActivate: [elevatedGuard], data: { reportType: 'project' } },
      { path: 'reports/funding-manager', component: ReportsComponent, canActivate: [elevatedGuard], data: { reportType: 'manager' } },
      { path: 'reports/funding-director', component: ReportsComponent, canActivate: [elevatedGuard], data: { reportType: 'director' } },
      { path: 'admin', component: AdminComponent, canActivate: [elevatedGuard] },
      { path: 'allocation', component: AllocationComponent, canActivate: [elevatedGuard] },
    ]
  },
  { path: '**', redirectTo: 'login' }
];
