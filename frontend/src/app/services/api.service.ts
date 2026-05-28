import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:3000/api';
  constructor(private http: HttpClient) {}

  getProjects(): Observable<any> { return this.http.get(`${this.base}/projects`); }
  getProject(id: number): Observable<any> { return this.http.get(`${this.base}/projects/${id}`); }
  getProjectDraft(id: number): Observable<any> { return this.http.get(`${this.base}/projects/${id}/draft`); }
  createVersion(projectId: number): Observable<any> { return this.http.post(`${this.base}/projects/${projectId}/versions`, {}); }
  getVersion(id: number): Observable<any> { return this.http.get(`${this.base}/versions/${id}`); }
  saveVersionRows(id: number, body: any): Observable<any> { return this.http.post(`${this.base}/versions/${id}/rows`, body); }
  submitVersion(id: number): Observable<any> { return this.http.put(`${this.base}/versions/${id}/submit`, {}); }
  getFunctions(): Observable<any> { return this.http.get(`${this.base}/functions`); }
  saveFunction(name: string): Observable<any> { return this.http.post(`${this.base}/functions`, { function_name: name }); }
}