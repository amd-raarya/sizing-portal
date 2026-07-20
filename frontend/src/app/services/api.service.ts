import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, timeout } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:3000/api';
  constructor(private http: HttpClient) {}

  getProjects(): Observable<any> { return this.http.get(`${this.base}/projects`); }
  getProject(id: number): Observable<any> { return this.http.get(`${this.base}/projects/${id}`); }
  getProjectDraft(id: number): Observable<any> { return this.http.get(`${this.base}/projects/${id}/draft`); }
  getProjectBaseline(id: number): Observable<any> { return this.http.get(`${this.base}/projects/${id}/baseline`); }
  getProjectBudgetSummary(): Observable<any> { return this.http.get(`${this.base}/projects/summary/budget`); }
  approveProject(id: number): Observable<any> { return this.http.patch(`${this.base}/projects/${id}/approve`, {}); }
  negotiateProject(id: number): Observable<any> { return this.http.patch(`${this.base}/projects/${id}/negotiate`, {}); }
  getProjectFormMeta(): Observable<any> { return this.http.get(`${this.base}/projects/meta/form`); }
  createProject(body: any): Observable<any> { return this.http.post(`${this.base}/projects`, body); }
  updateProject(id: number, body: any): Observable<any> { return this.http.patch(`${this.base}/projects/${id}`, body); }
  deleteProject(id: number): Observable<any> { return this.http.delete(`${this.base}/projects/${id}`); }
  createVersion(projectId: number): Observable<any> { return this.http.post(`${this.base}/projects/${projectId}/versions`, {}); }
  getVersion(id: number): Observable<any> { return this.http.get(`${this.base}/versions/${id}`); }

  // Sizing summary — cached for 60s so navigating back is instant
  private _sizingCache: any = null;
  private _sizingCacheAt = 0;
  getSizingSummary(forceRefresh = false): Observable<any> {
    if (!forceRefresh && this._sizingCache && Date.now() - this._sizingCacheAt < 60_000) {
      return of(this._sizingCache);
    }
    return this.http.get(`${this.base}/versions/sizing-summary`).pipe(
      timeout(15000), // fail fast after 15s instead of hanging forever
      tap(res => { this._sizingCache = res; this._sizingCacheAt = Date.now(); })
    );
  }
  invalidateSizingCache() { this._sizingCache = null; }
  saveVersionRows(id: number, body: any): Observable<any> { return this.http.post(`${this.base}/versions/${id}/rows`, body); }
  submitVersion(id: number, submitted_by?: string): Observable<any> { return this.http.put(`${this.base}/versions/${id}/submit`, { submitted_by: submitted_by || null }); }
  getFunctions(): Observable<any> { return this.http.get(`${this.base}/functions`); }
  saveFunction(name: string): Observable<any> { return this.http.post(`${this.base}/functions`, { function_name: name }); }
  saveScopeNotes(versionId: number, scope_notes: string): Observable<any> { return this.http.patch(`${this.base}/versions/${versionId}/scope`, { scope_notes }); }
  getMilestones(versionId: number): Observable<any> { return this.http.get(`${this.base}/versions/${versionId}/milestones`); }
  saveMilestone(versionId: number, body: any): Observable<any> { return this.http.post(`${this.base}/versions/${versionId}/milestones`, body); }

  // Rates
  getProjectRates(projectId: number): Observable<any> { return this.http.get(`${this.base}/projects/${projectId}/rates`); }
  saveProjectRates(projectId: number, rates: { location: string; rate_per_quarter: number }[]): Observable<any> { return this.http.post(`${this.base}/projects/${projectId}/rates`, { rates }); }

  // Documents
  getProjectDocuments(projectId: number): Observable<any> { return this.http.get(`${this.base}/documents/project/${projectId}`); }
  saveDocumentLink(projectId: number, body: { doc_label: string; doc_url: string; uploaded_by?: string }): Observable<any> { return this.http.post(`${this.base}/documents/project/${projectId}/link`, body); }
  uploadDocumentFile(projectId: number, file: File, uploadedBy?: string): Observable<any> {
    const fd = new FormData();
    fd.append('file', file);
    if (uploadedBy) fd.append('uploaded_by', uploadedBy);
    return this.http.post(`${this.base}/documents/project/${projectId}/file`, fd);
  }
  deleteDocument(docId: number): Observable<any> { return this.http.delete(`${this.base}/documents/${docId}`); }

  // Managers list
  getManagers(): Observable<any> { return this.http.get(`${this.base}/admin/managers`); }

  // Admin — users
  getAdminUsers(): Observable<any> { return this.http.get(`${this.base}/admin/users`); }
  createAdminUser(body: any): Observable<any> { return this.http.post(`${this.base}/admin/users`, body); }
  toggleAdminUser(pmUserId: number): Observable<any> { return this.http.patch(`${this.base}/admin/users/${pmUserId}/toggle`, {}); }

  // Admin — project access
  getAdminAccess(): Observable<any> { return this.http.get(`${this.base}/admin/access`); }
  getUserAccess(pmUserId: number): Observable<any> { return this.http.get(`${this.base}/admin/access/${pmUserId}`); }
  grantAccess(body: any): Observable<any> { return this.http.post(`${this.base}/admin/access`, body); }
  updateAccess(accessId: number, body: any): Observable<any> { return this.http.patch(`${this.base}/admin/access/${accessId}`, body); }
  revokeAccess(accessId: number): Observable<any> { return this.http.delete(`${this.base}/admin/access/${accessId}`); }
}