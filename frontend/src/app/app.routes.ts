import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';
import { ProjectsComponent } from './pages/projects/projects.component';
import { SizingComponent } from './pages/sizing/sizing.component';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: ProjectsComponent },
      { path: 'sizing/:projectId', component: SizingComponent }
    ]
  }
];