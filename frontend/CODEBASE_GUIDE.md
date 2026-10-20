# AMD Sizing & Resource Allocation Portal — Codebase Guide

> **Quick reference for developers joining the project.**  
> For full technical documentation see `backend/database_schema.sql` and the Confluence page.  
> For bugs raise a Jira ticket under project **AMD-SIZING**.  
> Source code: [AMD-Brahma/linux-hr-website](https://github.com/AMD-Brahma/linux-hr-website)

---

## Repository Structure

```
sizing-portal/
├── frontend/            Angular 21 SPA (PM portal)
├── backend/             Node.js + Express REST API
├── database_schema.sql  Authoritative DB schema (all CREATE TABLE statements)
├── deploy-watcher.js    Auto-deploy script (polls AMD GitHub every 2 min)
└── CODEBASE_GUIDE.md   This file
```

---

## Frontend — `frontend/src/app/`

### Entry Points

| File | Purpose |
|------|---------|
| `app.ts` | Root component — bootstraps the app |
| `app.routes.ts` | All URL routes (e.g. `/projects`, `/sizing/:id`, `/views/sizing`) |
| `app.config.ts` | Angular app config — HTTP client, animations, MSAL auth provider |

### Pages — `pages/`

Each page is a standalone Angular component (template + logic + CSS all in one `.ts` file).

| Component | Route | What it does |
|-----------|-------|-------------|
| `projects/` | `/projects` | Main landing page — project list, budget tiles, status filters, BU approve/negotiate/revise actions |
| `sizing/` | `/sizing/:projectId` | HC entry page — function rows, quarterly HC inputs, bar charts, milestones, save draft, submit |
| `views/` | `/views/sizing`, `/views/allocation`, `/views/gap` | Aggregated views across all projects — sizing chart, allocation quarterly bars, gap analysis |
| `gantt/` | `/views/gantt` | Mountain View / Project Gantt — HC ramp chart with milestone overlays |
| `reports/` | `/reports/*` | Fund breakdown by project, director, and manager |
| `allocation/` | `/allocation` | Resource Allocation tool — eligibility matrix with inline per-person capacity + steady state, over-capacity gap KPI, team load line chart, Assignment Output download (FY/Q range) |
| `trends/` | `/trends` | HC Trends & Forecast — Team (load vs capacity), Projects (small-multiple lines), People (heatmap + per-person line) |
| `admin/` | `/admin` | Admin panel — PM user management, project access control, import queue |
| `new-project/` | `/new-project` | New project creation form |
| `login/` | `/login` | MSAL login page |

### Services — `services/`

| File | Purpose |
|------|---------|
| `api.service.ts` | **Single source for all HTTP calls** — every API endpoint the frontend uses is defined here as an Observable method |
| `auth.service.ts` | Wraps MSAL — exposes `user()`, `isElevated()`, `logout()` |
| `quarter.service.ts` | Shared fiscal quarter generation utilities |

### Auth & Guards — `auth/`, `guards/`

| File | Purpose |
|------|---------|
| `auth/msal.config.ts` | Azure AD / MSAL configuration (client ID, tenant, scopes) |
| `guards/auth.guard.ts` | Route guard — redirects unauthenticated users to `/login` |

### Directives — `directives/`

| File | Purpose |
|------|---------|
| `content-editable.directive.ts` | `SafeHtmlDirective` — sanitizes HTML for rich-text fields in sizing table |
| `sticky-scrollbar.directive.ts` | `StickyScrollbarDirective` — keeps horizontal scrollbar always visible on wide tables |

### Shared Components — `shared/`

| File | Purpose |
|------|---------|
| `filter-bar/filter-bar.component.ts` | Reusable filter bar used across Projects and Views pages |
| `hc-line-chart/hc-line-chart.component.ts` | Dependency-free SVG line chart (`app-hc-line-chart`) — solid = recorded/planned, dashed = forecast, red dashed = capacity, "Today" marker, hover tooltip. Used by the Allocation KPI tile and the Trends page |

### Layout — `layout/`

| File | Purpose |
|------|---------|
| `layout/layout.component.ts` | App shell — AMD toolbar, sidebar nav, router outlet. All pages render inside this. |

---

## Backend — `backend/src/`

### Entry Point

| File | Purpose |
|------|---------|
| `server.js` | Express app setup — registers all routes, serves Angular static files, HTTPS with cert fallback, cron scheduler |

### Routes — `routes/`

Each file handles one domain of the API. All routes are mounted in `server.js` at `/api/<name>`.

| File | Mount path | Key responsibilities |
|------|-----------|---------------------|
| `projects.js` | `/api/projects` | Project CRUD, project list with budget aggregates, draft/baseline version lookup, PM access, revise-sizing (copy project), approve/negotiate |
| `versions.js` | `/api/versions` | HC version management — get/save rows, submit, milestones, sizing aggregates for Views page |
| `allocation.js` | `/api/allocation` | Resource allocation — team, eligibility matrix, steady state, compute algorithm, capacity, manager-projects scoping, export to Excel |
| `admin.js` | `/api/admin` | PM user management, project access control, import queue review, org headcount, history/retro data |
| `documents.js` | `/api/documents` | Project document links and file uploads |
| `functions.js` | `/api/functions` | Function contact autocomplete suggestions |

### Database — `db/`

| File | Purpose |
|------|---------|
| `db/connection.js` | MySQL connection pool — reads host/user/pass from `.env` |

### Background Jobs — `cron/`, `services/`

| File | Purpose |
|------|---------|
| `cron/deadlineAutoSubmit.js` | Runs daily at midnight — auto-submits sizing for projects past their deadline |
| `services/emailService.js` | Sends email notifications on save-draft and submit (uses AMD SMTP) |

---

## Key Conventions

### Angular
- **All components are standalone** — no NgModules
- **`ChangeDetectionStrategy.OnPush`** on performance-sensitive components
- **Signals** for reactive state (`signal()`, `computed()`)
- **`input()` / `output()` functions** — not `@Input()` / `@Output()` decorators
- **Inline templates** — template, styles, and logic all in one `.ts` file per component
- No `ngClass` / `ngStyle` — use `[class]` / `[style]` bindings

### Backend
- Plain **JavaScript** (`.js`) — no TypeScript in backend files
- **Every Save Draft creates a new version** — nothing is overwritten, full audit trail
- **Cost is never stored** — always computed as `headcount × rate_per_quarter` from `RA_project_rates`
- All DB tables use the `RA_` prefix in schema `scbumatplan`

### Deployment
- **Auto-deploy**: `git push amd main` → server detects within 2 minutes, builds, restarts
- Server runs under **PM2** — processes: `sizing-portal`, `deploy-watcher`, `folder-watcher`
- PM2 configured to survive reboots (`pm2 startup` + `pm2 save`)
- Server: `ausvlinuxapp01.amd.com` — HTTPS port 3000

### Environment
- Local dev: `frontend/` uses `ng serve` → hits `http://localhost:3000/api`
- Production: Angular built with `ng build` → served as static files by Express
- Secrets in `backend/.env` — never committed to git

---

## Adding a New Feature — Quick Checklist

1. **Backend**: Add route to the appropriate file in `backend/src/routes/`
2. **API service**: Add Observable method to `frontend/src/app/services/api.service.ts`
3. **Component**: Update the relevant page component in `frontend/src/app/pages/`
4. **Schema change?** → Update `backend/database_schema.sql` in the same commit
5. **Push**: `git push amd main` — auto-deploys within 2 minutes

---

*Last updated: October 2026 — Rahul Arya (rahul.arya@amd.com)*
