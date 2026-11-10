import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getProjects(email?: string): Observable<any> {
    const q = email ? `?email=${encodeURIComponent(email)}` : '';
    return this.http.get(`${this.base}/projects${q}`);
  }
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
  createVersion(projectId: number, saved_by?: string): Observable<any> { return this.http.post(`${this.base}/projects/${projectId}/versions`, { saved_by }); }
  getVersion(id: number): Observable<any> { return this.http.get(`${this.base}/versions/${id}`); }

  // Sizing summary — cached for 60s so navigating back is instant
  private _sizingCache: any = null;
  private _sizingCacheAt = 0;
  getSizingSummary(forceRefresh = false): Observable<any> {
    if (!forceRefresh && this._sizingCache && Date.now() - this._sizingCacheAt < 60_000) {
      return of(this._sizingCache);
    }
    return this.http.get(`${this.base}/versions/sizing-summary`).pipe(
      tap(res => { this._sizingCache = res; this._sizingCacheAt = Date.now(); })
    );
  }
  invalidateSizingCache() { this._sizingCache = null; }

  // Pre-aggregated endpoint — returns rows + quarter totals pre-computed in MySQL
  private _aggCache: any = null;
  private _aggCacheAt = 0;
  getSizingAggregates(forceRefresh = false): Observable<any> {
    if (!forceRefresh && this._aggCache && Date.now() - this._aggCacheAt < 60_000) {
      return of(this._aggCache);
    }
    return this.http.get(`${this.base}/versions/sizing-aggregates`).pipe(
      tap(res => { this._aggCache = res; this._aggCacheAt = Date.now(); })
    );
  }
  invalidateAggCache() { this._aggCache = null; }
  saveVersionRows(id: number, body: any): Observable<any> { return this.http.post(`${this.base}/versions/${id}/rows`, body); }
  submitVersion(id: number, submitted_by?: string): Observable<any> { return this.http.put(`${this.base}/versions/${id}/submit`, { submitted_by: submitted_by || null }); }
  getFunctions(): Observable<any> { return this.http.get(`${this.base}/functions`); }
  saveFunction(name: string): Observable<any> { return this.http.post(`${this.base}/functions`, { function_name: name }); }
  saveScopeNotes(versionId: number, scope_notes: string): Observable<any> { return this.http.patch(`${this.base}/versions/${versionId}/scope`, { scope_notes }); }
  getMilestones(versionId: number): Observable<any> { return this.http.get(`${this.base}/versions/${versionId}/milestones`); }
  saveMilestone(versionId: number, body: any): Observable<any> { return this.http.post(`${this.base}/versions/${versionId}/milestones`, body); }
  saveMilestonesAll(versionId: number, milestones: {milestone_name: string; start_date: string|null; end_date: string|null}[]): Observable<any> { return this.http.put(`${this.base}/versions/${versionId}/milestones`, { milestones }); }
  reviseVersion(versionId: number, created_by?: string): Observable<any> { return this.http.post(`${this.base}/versions/${versionId}/revise`, { created_by }); }
  reviseProject(projectId: number, created_by?: string): Observable<any> { return this.http.post(`${this.base}/projects/${projectId}/revise`, { created_by }); }
  // 21 = current quarter + 20 ahead, so every quarter in the 5-year window has a value
  getForecast(managerName?: string, quartersAhead = 21): Observable<any> {
    const p = new URLSearchParams({ quarters_ahead: String(quartersAhead) });
    if (managerName) p.set('manager_name', managerName);
    return this.http.get(`${this.base}/allocation/forecast?${p.toString()}`);
  }
  getMilestoneTypes(): Observable<any> { return this.http.get(`${this.base}/versions/milestone-types`); }
  saveMilestoneType(body: { milestone_name: string; color?: string }): Observable<any> { return this.http.post(`${this.base}/versions/milestone-types`, body); }

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

  // Admin — lookup user by email
  getUserByEmail(email: string): Observable<any> {
    return this.http.get(`${this.base}/admin/users/by-email?email=${encodeURIComponent(email)}`);
  }

  // Admin — people (all RA_people)
  getAdminPeople(): Observable<any> { return this.http.get(`${this.base}/admin/people`); }
  getOrgHeadcount(root = 'Weyman, Jeff'): Observable<any> { return this.http.get(`${this.base}/admin/org-headcount?root=${encodeURIComponent(root)}`); }
  getSteadyStateTasks(): Observable<any> { return this.http.get(`${this.base}/admin/steady-state-tasks`); }
  getRetroProjects(): Observable<any> { return this.http.get(`${this.base}/admin/retro-projects`); }
  getHistory(params: { person_name?: string; task_code?: string; fy_from?: number; fy_to?: number; manager_name?: string } = {}): Observable<any> {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) p.set(k, String(v)); });
    return this.http.get(`${this.base}/admin/history?${p.toString()}`);
  }
  getHistoryPersonSummary(personName?: string, fyFrom = 2024, fyTo = 2027): Observable<any> {
    const p = new URLSearchParams({ fy_from: String(fyFrom), fy_to: String(fyTo) });
    if (personName) p.set('person_name', personName);
    return this.http.get(`${this.base}/admin/history/person-summary?${p.toString()}`);
  }
  updateSteadyStateTask(taskId: number, body: any): Observable<any> { return this.http.patch(`${this.base}/admin/steady-state-tasks/${taskId}`, body); }
  getSteadyStateEffort(): Observable<any> { return this.http.get(`${this.base}/admin/steady-state-effort`); }
  saveSteadyStateEffortBulk(records: any[], setBy?: string): Observable<any> { return this.http.post(`${this.base}/admin/steady-state-effort/bulk`, { records, set_by: setBy }); }
  getSsEligibility(personId?: number): Observable<any> {
    const p = personId ? `?person_id=${personId}` : '';
    return this.http.get(`${this.base}/admin/steady-state-eligibility${p}`);
  }
  saveSsEligibilityBulk(personId: number, taskIds: number[], addedBy?: string): Observable<any> {
    return this.http.post(`${this.base}/admin/steady-state-eligibility/bulk`, { person_id: personId, task_ids: taskIds, added_by: addedBy });
  }
  distributeSsEffort(distributions: any[], setBy?: string): Observable<any> {
    return this.http.post(`${this.base}/admin/steady-state-distribute`, { distributions, set_by: setBy });
  }
  getAdminPersonCapacity(managerName?: string): Observable<any> {
    const p = managerName ? `?manager_name=${encodeURIComponent(managerName)}` : '';
    return this.http.get(`${this.base}/admin/person-capacity${p}`);
  }
  promoteToElevated(personId: number, designation?: string): Observable<any> {
    return this.http.patch(`${this.base}/admin/people/${personId}/promote`, { designation: designation || 'Senior Manager' });
  }
  setElevated(pmUserId: number, isElevated: boolean): Observable<any> {
    return this.http.patch(`${this.base}/admin/users/${pmUserId}/elevated`, { is_elevated: isElevated });
  }
  upsertAccess(body: { pm_user_id: number; project_id: number; level: string }): Observable<any> {
    return this.http.post(`${this.base}/admin/access/upsert`, body);
  }

  // Sizing Excel upload (Sam's file)
  uploadSizingExcel(file: File): Observable<any> {
    const fd = new FormData(); fd.append('file', file);
    return this.http.post(`${this.base}/admin/upload-sizing`, fd);
  }
  commitSizingUpload(body: { projects: any[]; rates: any; submitted_by?: string }): Observable<any> {
    return this.http.post(`${this.base}/admin/upload-sizing/commit`, body);
  }

  // Admin — users
  getAdminUsers(): Observable<any> { return this.http.get(`${this.base}/admin/users`); }
  createAdminUser(body: any): Observable<any> { return this.http.post(`${this.base}/admin/users`, body); }
  toggleAdminUser(pmUserId: number): Observable<any> { return this.http.patch(`${this.base}/admin/users/${pmUserId}/toggle`, {}); }

  // Allocation
  getAllocationTeam(managerName?: string): Observable<any> {
    const p = managerName ? `?manager_name=${encodeURIComponent(managerName)}` : '';
    return this.http.get(`${this.base}/allocation/team${p}`);
  }
  getAllocationOrgTree(managerName: string): Observable<any> {
    return this.http.get(`${this.base}/allocation/org-tree?manager_name=${encodeURIComponent(managerName)}`);
  }
  getAllocationEligibility(managerName?: string): Observable<any> {
    const p = managerName ? `?manager_name=${encodeURIComponent(managerName)}` : '';
    return this.http.get(`${this.base}/allocation/eligibility${p}`);
  }
  saveAllocationEligibility(record: { person_id: number; project_id: number; capability: string; set_by?: string }): Observable<any> {
    return this.http.post(`${this.base}/allocation/eligibility`, record);
  }
  bulkSaveAllocationEligibility(records: any[], set_by?: string): Observable<any> {
    return this.http.post(`${this.base}/allocation/eligibility/bulk`, { records, set_by });
  }
  getAllocationSummary(managerName?: string): Observable<any> {
    const p = managerName ? `?manager_name=${encodeURIComponent(managerName)}` : '';
    return this.http.get(`${this.base}/allocation/summary${p}`);
  }
  exportAllocation(managerName?: string, format: 'monthly' | 'weekly' = 'monthly', fromQuarter?: string, toQuarter?: string, includeEstimates = false, useFlex = true): Observable<Blob> {
    return this.http.get(`${this.base}/allocation/export?${this.outputParams(managerName, format, fromQuarter, toQuarter, includeEstimates, useFlex)}`, { responseType: 'blob' });
  }
  /** The lines of the Assignment Output as JSON — same model as the download, so the preview equals the file. */
  getOutputPreview(managerName?: string, format: 'monthly' | 'weekly' = 'monthly', fromQuarter?: string, toQuarter?: string, includeEstimates = false, useFlex = true): Observable<any> {
    return this.http.get(`${this.base}/allocation/output-preview?${this.outputParams(managerName, format, fromQuarter, toQuarter, includeEstimates, useFlex)}`);
  }
  /** Projects this manager leaves out of the Assignment Output (output only — matrix, views and saved data are untouched). */
  getOutputExclusions(managerName?: string): Observable<any> {
    const p = managerName ? `?manager_name=${encodeURIComponent(managerName)}` : '';
    return this.http.get(`${this.base}/allocation/output-exclusions${p}`);
  }
  saveOutputExclusions(managerName: string | undefined, projectIds: number[], excludedBy?: string): Observable<any> {
    return this.http.put(`${this.base}/allocation/output-exclusions`, { manager_name: managerName || '', project_ids: projectIds, excluded_by: excludedBy });
  }
  private outputParams(managerName: string | undefined, format: string, from?: string, to?: string, includeEstimates = false, useFlex = true): string {
    const p = new URLSearchParams();
    if (managerName) p.set('manager_name', managerName);
    p.set('format', format);
    if (from) p.set('from_quarter', from);
    if (to) p.set('to_quarter', to);
    if (includeEstimates) p.set('include_estimates', '1');
    if (!useFlex) p.set('flex', '0');   // approved sizing only, without the project adjustments
    return p.toString();
  }

  // ── Forecast estimates (pilot users only; the backend checks the e-mail we send) ──
  private auth = inject(AuthService);
  private fcOpts() { return { headers: { 'x-user-email': this.auth.user()?.email || '' } }; }
  // ── Project flex: adjustable rules (move / extend / scale) on top of the approved sizing, applied live (elevated users) ──
  listProjectFlex(): Observable<any> { return this.http.get(`${this.base}/flex`, this.fcOpts()); }
  getProjectFlex(projectId: number): Observable<any> { return this.http.get(`${this.base}/flex/${projectId}`, this.fcOpts()); }
  previewProjectFlex(projectId: number, rule: any): Observable<any> { return this.http.post(`${this.base}/flex/${projectId}/preview`, { rule }, this.fcOpts()); }
  saveProjectFlex(projectId: number, rule: any): Observable<any> { return this.http.put(`${this.base}/flex/${projectId}`, { rule }, this.fcOpts()); }
  resetProjectFlex(projectId: number): Observable<any> { return this.http.delete(`${this.base}/flex/${projectId}`, this.fcOpts()); }
  getForecastAccess(email: string): Observable<any> { return this.http.get(`${this.base}/estimates/access?email=${encodeURIComponent(email)}`); }
  getForecastBuckets(): Observable<any> { return this.http.get(`${this.base}/estimates/buckets`, this.fcOpts()); }
  updateForecastBucket(id: number, body: { name?: string; shape_label?: string; typical_peak_hc?: number }): Observable<any> {
    return this.http.put(`${this.base}/estimates/buckets/${id}`, body, this.fcOpts());
  }
  relearnForecastBucket(id: number): Observable<any> { return this.http.post(`${this.base}/estimates/buckets/${id}/learn`, {}, this.fcOpts()); }
  /** What the curve would look like with these anchor milestones — computed, nothing saved */
  previewForecastBucketLearn(id: number, shape: { start: string; end: string[]; combine: string; guideline: number }): Observable<any> {
    return this.http.post(`${this.base}/estimates/buckets/${id}/learn`, { shape, dry_run: true }, this.fcOpts());
  }
  saveForecastBucketShape(id: number, shape: { start: string; end: string[]; combine: string; guideline: number }): Observable<any> {
    return this.http.put(`${this.base}/estimates/buckets/${id}/shape`, shape, this.fcOpts());
  }
  getForecastHistoryProjects(): Observable<any> { return this.http.get(`${this.base}/estimates/history-projects`, this.fcOpts()); }
  setForecastBucketMember(projectId: number, bucketId: number | null): Observable<any> {
    return this.http.put(`${this.base}/estimates/bucket-members`, { project_id: projectId, bucket_id: bucketId }, this.fcOpts());
  }
  suggestForecastStakeholders(bucketId: number, referenceProjectId?: number): Observable<any> {
    const r = referenceProjectId ? `&reference_project_id=${referenceProjectId}` : '';
    return this.http.get(`${this.base}/estimates/suggest-stakeholders?bucket_id=${bucketId}${r}`, this.fcOpts());
  }
  getForecastManagers(): Observable<any> { return this.http.get(`${this.base}/estimates/managers`, this.fcOpts()); }
  previewForecast(body: any): Observable<any> { return this.http.post(`${this.base}/estimates/preview`, body, this.fcOpts()); }
  getForecastProjects(): Observable<any> { return this.http.get(`${this.base}/estimates/projects`, this.fcOpts()); }
  createForecastProject(body: any): Observable<any> { return this.http.post(`${this.base}/estimates/projects`, body, this.fcOpts()); }
  updateForecastProject(id: number, body: any): Observable<any> { return this.http.patch(`${this.base}/estimates/projects/${id}`, body, this.fcOpts()); }
  cancelForecastProject(id: number): Observable<any> { return this.http.delete(`${this.base}/estimates/projects/${id}`, this.fcOpts()); }
  promoteForecastProject(id: number, projectId: number): Observable<any> {
    return this.http.post(`${this.base}/estimates/projects/${id}/promote`, { project_id: projectId }, this.fcOpts());
  }
  computeAllocation(managerName?: string): Observable<any> {
    const p = managerName ? `?manager_name=${encodeURIComponent(managerName)}` : '';
    return this.http.get(`${this.base}/allocation/compute${p}`);
  }
  getManagerAllotment(managerName: string): Observable<any> {
    return this.http.get(`${this.base}/allocation/manager-allotment?manager_name=${encodeURIComponent(managerName)}`);
  }
  /** Projects scoped to this manager (via sizing rows), with HC per quarter + team eligibility */
  getManagerProjects(managerName: string, includeEstimates = false): Observable<any> {
    return this.http.get(`${this.base}/allocation/manager-projects?manager_name=${encodeURIComponent(managerName)}${includeEstimates ? '&include_estimates=1' : ''}`);
  }
  /** Assignment engine: dry run on the saved state + the unsaved matrix ticks. Writes nothing. */
  previewAssignmentPlan(managerName: string, pending: { person_id: number; project_id: number; capability: string }[], includeEstimates = false): Observable<any> {
    return this.http.post(`${this.base}/allocation/plan/preview`, { manager_name: managerName, pending, include_estimates: includeEstimates });
  }
  /** Assignment engine: write the plan for the (already saved) eligibility into the effort table. */
  saveAssignmentPlan(managerName: string): Observable<any> {
    return this.http.post(`${this.base}/allocation/plan/save`, { manager_name: managerName });
  }
  getProjectQuarterlyTotals(projectId: number): Observable<any> {
    return this.http.get(`${this.base}/allocation/project-quarterly?project_id=${projectId}`);
  }
  getEffort(projectId: number): Observable<any> { return this.http.get(`${this.base}/allocation/effort?project_id=${projectId}`); }
  saveEffortBulk(projectId: number, records: any[], setBy?: string): Observable<any> {
    return this.http.post(`${this.base}/allocation/effort/bulk`, { project_id: projectId, records, set_by: setBy });
  }
  getPersonCapacity(managerName?: string): Observable<any> {
    const p = managerName ? `?manager_name=${encodeURIComponent(managerName)}` : '';
    return this.http.get(`${this.base}/allocation/person-capacity${p}`);
  }

  // Admin — project access
  getAdminAccess(): Observable<any> { return this.http.get(`${this.base}/admin/access`); }
  getUserAccess(pmUserId: number): Observable<any> { return this.http.get(`${this.base}/admin/access/${pmUserId}`); }
  grantAccess(body: any): Observable<any> { return this.http.post(`${this.base}/admin/access`, body); }
  updateAccess(accessId: number, body: any): Observable<any> { return this.http.patch(`${this.base}/admin/access/${accessId}`, body); }
  revokeAccess(accessId: number): Observable<any> { return this.http.delete(`${this.base}/admin/access/${accessId}`); }

  // Import Queue
  getImportQueue(): Observable<any> { return this.http.get(`${this.base}/admin/import-queue`); }
  approveImportQueue(id: number, body: { reviewed_by?: string; project_id_override?: number }): Observable<any> {
    return this.http.patch(`${this.base}/admin/import-queue/${id}/approve`, body);
  }
  rejectImportQueue(id: number, body: { reviewed_by?: string }): Observable<any> {
    return this.http.patch(`${this.base}/admin/import-queue/${id}/reject`, body);
  }
}