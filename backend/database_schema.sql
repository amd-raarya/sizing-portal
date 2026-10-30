-- ================================================================
-- AMD SPG Sizing Portal — Database Schema
-- Database: scbumatplan
-- Engine: MySQL 8+
-- ================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ── Core Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS RA_people (
  person_id         INT AUTO_INCREMENT PRIMARY KEY,
  display_name      VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NULL,
  designation       VARCHAR(100) NULL,
  location          VARCHAR(100) NULL,
  employment_type   VARCHAR(50)  NULL,
  reporting_manager VARCHAR(255) NULL,
  function_area     VARCHAR(100) NULL,
  top_level_team    VARCHAR(100) NULL,
  is_active         TINYINT(1) DEFAULT 1,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS RA_projects (
  project_id        INT AUTO_INCREMENT PRIMARY KEY,
  project_name      VARCHAR(255) NOT NULL,
  project_code      VARCHAR(50)  DEFAULT '',
  BU                VARCHAR(100) DEFAULT '',
  category          VARCHAR(100) NULL,
  leader            VARCHAR(255) NULL,
  top_level_team    VARCHAR(100) NULL,
  platform          VARCHAR(255) NULL,
  status            ENUM('pipeline','active','under review','paused','cancelled','closed','bu_approved') DEFAULT 'pipeline',
  programme         VARCHAR(100) NULL,
  retro_category    VARCHAR(20)  NULL COMMENT 'gap | commit | ss_task | unassigned — excludes from projects page',
  parent_project_id INT NULL,
  is_test           TINYINT(1) DEFAULT 0,
  is_techprotect    TINYINT(1) DEFAULT 0,
  sizing_deadline   DATE NULL,
  notes             TEXT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_project_id) REFERENCES RA_projects(project_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS RA_sizing_versions (
  version_id        INT AUTO_INCREMENT PRIMARY KEY,
  project_id        INT NOT NULL,
  version_status    ENUM('draft','submitted','locked','bu_approved') DEFAULT 'draft',
  submitted_by      VARCHAR(255) NULL,
  submitted_at      DATETIME NULL,
  scope_notes       TEXT NULL,
  last_saved_by     VARCHAR(255) NULL,
  last_saved_at     DATETIME NULL,
  parent_version_id INT NULL COMMENT 'Set when this is a revision of a submitted version — original stays untouched',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_version_id) REFERENCES RA_sizing_versions(version_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS RA_staging_headcount (
  staging_id    INT AUTO_INCREMENT PRIMARY KEY,
  version_id    INT NOT NULL,
  function_name VARCHAR(255) DEFAULT '',
  location      VARCHAR(100) DEFAULT '',
  hc_type       VARCHAR(100) DEFAULT '',
  manager_name  VARCHAR(255) NULL,
  scope         TEXT NULL,
  assumptions   TEXT NULL,
  risks         TEXT NULL,
  notes         TEXT NULL,
  FOREIGN KEY (version_id) REFERENCES RA_sizing_versions(version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RA_staging_quarterly (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  staging_id  INT NOT NULL,
  fiscal_year INT NOT NULL,
  quarter     INT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  headcount   DECIMAL(8,3) DEFAULT 0,
  FOREIGN KEY (staging_id) REFERENCES RA_staging_headcount(staging_id) ON DELETE CASCADE
);

-- ── Milestones ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS RA_version_milestones (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  version_id     INT NOT NULL,
  milestone_name VARCHAR(100) NOT NULL,
  start_date     DATE NULL,
  end_date       DATE NULL,
  UNIQUE KEY uq_version_milestone (version_id, milestone_name),
  FOREIGN KEY (version_id) REFERENCES RA_sizing_versions(version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RA_milestone_types (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  milestone_name VARCHAR(100) NOT NULL UNIQUE,
  color          VARCHAR(7) DEFAULT '#607d8b',
  display_order  INT DEFAULT 99,
  is_system      TINYINT(1) DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Allocation & Resource ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS RA_resource_eligibility (
  eligibility_id INT AUTO_INCREMENT PRIMARY KEY,
  person_id      INT NOT NULL,
  project_id     INT NOT NULL,
  capability     ENUM('yes','no','expert') DEFAULT 'yes',
  set_by         VARCHAR(255) NULL,
  set_at         DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_person_project (person_id, project_id),
  FOREIGN KEY (person_id) REFERENCES RA_people(person_id),
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id)
);

CREATE TABLE IF NOT EXISTS RA_person_project_effort (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  person_id    INT NOT NULL,
  project_id   INT NOT NULL,
  fiscal_year  INT NOT NULL,
  quarter      INT NOT NULL,
  effort_hc    DECIMAL(8,3) DEFAULT 0,
  set_by       VARCHAR(100) NULL,
  project_type VARCHAR(20) NULL COMMENT 'gap | commit | NULL for regular',
  auto_hc      DECIMAL(8,3) NOT NULL DEFAULT 0 COMMENT 'part of effort_hc added by the assignment engine (set_by auto_plan creates rows; merged rows keep their set_by)',
  m1           DECIMAL(8,3) NULL COMMENT 'month 1 of the calendar quarter as uploaded (Jan/Apr/Jul/Oct); effort_hc = average of m1..m3; NULL = flat quarter',
  m2           DECIMAL(8,3) NULL COMMENT 'month 2 (Feb/May/Aug/Nov)',
  m3           DECIMAL(8,3) NULL COMMENT 'month 3 (Mar/Jun/Sep/Dec)',
  created_at   DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_person_proj_q (person_id, project_id, fiscal_year, quarter),
  FOREIGN KEY (person_id) REFERENCES RA_people(person_id),
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id)
);

CREATE TABLE IF NOT EXISTS RA_steady_state_tasks (
  task_id      INT AUTO_INCREMENT PRIMARY KEY,
  task_code    VARCHAR(20) NULL,
  task_name    VARCHAR(150) NOT NULL,
  total_hc     DECIMAL(5,1) DEFAULT 0.0,
  description  TEXT NULL,
  color        VARCHAR(7) DEFAULT '#607d8b',
  is_attributable TINYINT(1) DEFAULT 1,
  is_active    TINYINT(1) DEFAULT 1,
  created_by   VARCHAR(100) NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS RA_steady_state_eligibility (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  task_id    INT NOT NULL,
  person_id  INT NOT NULL,
  added_by   VARCHAR(255) NULL,
  added_at   DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_task_person (task_id, person_id),
  FOREIGN KEY (task_id) REFERENCES RA_steady_state_tasks(task_id),
  FOREIGN KEY (person_id) REFERENCES RA_people(person_id)
);

CREATE TABLE IF NOT EXISTS RA_task_person_assignment (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  task_id     INT NOT NULL,
  person_id   INT NOT NULL,
  effort_hc   DECIMAL(6,3) DEFAULT 0,
  assigned_by VARCHAR(255) NULL,
  assigned_at DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_task_person (task_id, person_id),
  FOREIGN KEY (task_id) REFERENCES RA_steady_state_tasks(task_id),
  FOREIGN KEY (person_id) REFERENCES RA_people(person_id)
);

CREATE TABLE IF NOT EXISTS RA_task_person_history (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  task_code   VARCHAR(100) NULL,
  task_name   VARCHAR(255) NULL,
  person_name VARCHAR(255) NULL,
  fiscal_year INT NULL,
  quarter     INT NULL,
  effort_hc   DECIMAL(6,3) NULL,
  source      VARCHAR(50) NULL,
  created_at  DATETIME DEFAULT NOW(),
  INDEX idx_person (person_name),
  INDEX idx_task (task_code),
  INDEX idx_fy (fiscal_year, quarter)
);

-- ── Access & Users ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS RA_pm_users (
  pm_user_id   INT AUTO_INCREMENT PRIMARY KEY,
  person_id    INT NULL,
  display_name VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  is_active    TINYINT(1) DEFAULT 1,
  is_elevated  TINYINT(1) DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES RA_people(person_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS RA_pm_project_access (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  pm_user_id INT NOT NULL,
  project_id INT NOT NULL,
  can_view   TINYINT(1) DEFAULT 1,
  can_edit   TINYINT(1) DEFAULT 1,
  can_submit TINYINT(1) DEFAULT 0,
  level      VARCHAR(20) DEFAULT 'read',
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_project (pm_user_id, project_id),
  FOREIGN KEY (pm_user_id) REFERENCES RA_pm_users(pm_user_id),
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id) ON DELETE CASCADE
);

-- ── Documents & Rates ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS RA_documents (
  doc_id      INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT NOT NULL,
  doc_label   VARCHAR(255) NULL,
  doc_url     TEXT NULL,
  file_path   TEXT NULL,
  file_name   VARCHAR(255) NULL,
  uploaded_by VARCHAR(255) NULL,
  uploaded_at DATETIME DEFAULT NOW(),
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RA_project_rates (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  project_id       INT NOT NULL,
  location         VARCHAR(100) NOT NULL,
  rate_per_quarter DECIMAL(10,2) NOT NULL,
  UNIQUE KEY uq_project_location (project_id, location),
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id) ON DELETE CASCADE
);

-- ── Import Queue (folder watcher) ────────────────────────────────

CREATE TABLE IF NOT EXISTS RA_import_queue (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  file_type            ENUM('sizing','document') NOT NULL,
  original_name        VARCHAR(255) NOT NULL,
  stored_path          VARCHAR(500) NOT NULL,
  parse_result         LONGTEXT NULL,
  status               ENUM('pending','approved','rejected','error') DEFAULT 'pending',
  matched_project_id   INT NULL,
  matched_project_name VARCHAR(255) NULL,
  error_message        VARCHAR(500) NULL,
  queued_at            DATETIME DEFAULT NOW(),
  reviewed_at          DATETIME NULL,
  reviewed_by          VARCHAR(100) NULL,
  FOREIGN KEY (matched_project_id) REFERENCES RA_projects(project_id) ON DELETE SET NULL
);

-- ── Org structure ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS RA_org_headcount (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  manager_name    VARCHAR(255) NOT NULL,
  total_headcount INT DEFAULT 0,
  last_updated    DATETIME DEFAULT NOW()
);

-- ── Project Documents ─────────────────────────────────────────────
-- Stores both URL links and uploaded file references per project

CREATE TABLE IF NOT EXISTS RA_project_documents (
  doc_id      INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT NOT NULL,
  doc_type    ENUM('link','file') DEFAULT 'link',
  doc_label   VARCHAR(500) NULL,
  doc_url     VARCHAR(1000) NULL,
  file_name   VARCHAR(500) NULL,
  file_path   VARCHAR(1000) NULL,
  uploaded_by VARCHAR(255) NULL,
  created_at  DATETIME DEFAULT NOW(),
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id) ON DELETE CASCADE
);

-- ── Function Suggestions ──────────────────────────────────────────
-- Autocomplete suggestions for the Function Contact field in HC entry

CREATE TABLE IF NOT EXISTS RA_function_suggestions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  function_name VARCHAR(255) NOT NULL UNIQUE
);

SET FOREIGN_KEY_CHECKS = 1;

-- ================================================================
-- KEY QUERIES (no stored procedures — all logic runs in Node.js)
-- ================================================================

-- Best version per project (highest version_id with actual HC data):
-- SELECT v.project_id, MAX(v.version_id) AS best_version_id
-- FROM RA_sizing_versions v
-- WHERE v.version_id IN (
--   SELECT DISTINCT sh.version_id FROM RA_staging_headcount sh
--   JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
-- )
-- GROUP BY v.project_id;

-- Quarter HC totals for sizing view (pre-aggregated in Node.js):
-- SELECT p.project_name, p.BU, sh.location, sh.hc_type,
--        sq.fiscal_year, sq.quarter, SUM(sq.headcount) AS hc
-- FROM RA_sizing_versions v
-- JOIN RA_projects p ON p.project_id = v.project_id
-- JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
-- JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
-- GROUP BY p.project_name, p.BU, sh.location, sh.hc_type, sq.fiscal_year, sq.quarter;

-- Project budget estimate (cost = headcount × location rate, computed in Node.js):
-- Rates stored in versions.js: USA $57,001 | India $8,868 | Canada $30,138 etc.
-- Total cost = SUM(headcount_per_quarter × annual_rate / 4) across all quarters

-- Projects assigned to a PM user:
-- SELECT p.* FROM RA_projects p
-- JOIN RA_pm_project_access a ON a.project_id = p.project_id
-- JOIN RA_pm_users u ON u.pm_user_id = a.pm_user_id
-- WHERE u.email = ? AND u.is_active = 1;

-- ================================================================
-- INDEXES (recommended for performance)
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_staging_hc_version   ON RA_staging_headcount(version_id);
CREATE INDEX IF NOT EXISTS idx_staging_q_staging     ON RA_staging_quarterly(staging_id);
CREATE INDEX IF NOT EXISTS idx_versions_project      ON RA_sizing_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_version    ON RA_version_milestones(version_id);
CREATE INDEX IF NOT EXISTS idx_access_pm_user        ON RA_pm_project_access(pm_user_id);
CREATE INDEX IF NOT EXISTS idx_access_project        ON RA_pm_project_access(project_id);

-- Migration (auto-assignment engine, 2026-10-21) for an existing database — also applied automatically at backend start:
-- ALTER TABLE RA_person_project_effort ADD COLUMN auto_hc DECIMAL(8,3) NOT NULL DEFAULT 0;

-- Migration (month shape of retro data, 2026-10-22) — also applied automatically at backend start; values backfilled from Retro Data-63dc106d.xlsx:
-- ALTER TABLE RA_person_project_effort ADD COLUMN m1 DECIMAL(8,3) NULL, ADD COLUMN m2 DECIMAL(8,3) NULL, ADD COLUMN m3 DECIMAL(8,3) NULL;

-- ================================================================
-- ASSIGNMENT OUTPUT: per-manager project exclusions (2026-10-27)
-- A manager can leave a project OUT of the downloaded Assignment Output without touching saved data,
-- the matrix or the views. Created automatically by the backend (CREATE TABLE IF NOT EXISTS) on first use.
-- manager_name '' = the "all teams" output.
-- ================================================================
CREATE TABLE IF NOT EXISTS RA_output_exclusions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  manager_name VARCHAR(200) NOT NULL DEFAULT '',
  project_id   INT NOT NULL,
  excluded_by  VARCHAR(200) NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_output_excl (manager_name, project_id),
  KEY idx_output_excl_mgr (manager_name)
);

-- ================================================================
-- FORECAST ESTIMATES (2026-10-27) — placeholders for projects that are not sized yet
-- Own tables (never RA_projects) so no existing list / filter / cron can see them. Created automatically by the backend
-- (CREATE TABLE IF NOT EXISTS + 5 template buckets seeded when empty) on first use of /api/estimates or include_estimates.
-- The assignment engine addresses a placeholder by the pseudo project id -forecast_id; estimates are never written to
-- RA_person_project_effort. Access: elevated users on the allow-list (env FORECAST_ALLOWED_EMAILS, '*' = all elevated).
-- ================================================================
CREATE TABLE IF NOT EXISTS RA_forecast_buckets (
  bucket_id       INT AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(10)  NOT NULL,
  name            VARCHAR(100) NOT NULL,
  shape_label     VARCHAR(60)  NULL,
  typical_peak_hc DECIMAL(8,2) NOT NULL DEFAULT 5,
  curve_json      TEXT NOT NULL,                       -- share of typical peak per quarter from the start quarter
  curve_source    ENUM('template','learned') NOT NULL DEFAULT 'template',
  manager_shares_json TEXT NULL,                       -- manager split of a typical project in this bucket, snapshot taken when the curve is learned
  milestones_json TEXT NULL,                           -- where each milestone usually falls: [{name, offset_q (quarters after the first HC quarter), n (projects)}], learned with the curve
  shape_config_json TEXT NULL,                         -- how the curve is built: {start: milestone ending the guideline ramp-up (e.g. BTO), end: [ordered candidates the projects are lined up on, e.g. UU then A0 Asic Back; each project uses the first it has, projects with none are averaged in on their own start], combine: 'average'|'median', guideline: 0..1 share of the guideline trapezoid in the blend (default 0 = pure aligned average/median)}; 'learned' key = what the last learn measured
  anchor_milestones_json TEXT NULL,                    -- no longer used (replaced by shape_config_json)
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bucket_code (code)
);
CREATE TABLE IF NOT EXISTS RA_forecast_bucket_members (   -- which past project belongs to which bucket
  project_id  INT NOT NULL PRIMARY KEY,
  bucket_id   INT NOT NULL,
  assigned_by VARCHAR(200) NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fbm_bucket (bucket_id)
);
CREATE TABLE IF NOT EXISTS RA_forecast_projects (
  forecast_id          INT AUTO_INCREMENT PRIMARY KEY,
  project_name         VARCHAR(255) NOT NULL,
  bucket_id            INT NOT NULL,
  complexity           DECIMAL(5,2) NOT NULL DEFAULT 1.00,   -- scales the bucket's typical peak HC
  peak_hc_override     DECIMAL(8,2) NULL,                    -- no longer used (complexity is the only HC adjustment)
  start_fy             INT NOT NULL,
  start_q              INT NOT NULL,
  silicon_fy           INT NULL,                              -- no longer used (replaced by RA_forecast_milestones)
  silicon_q            INT NULL,
  reference_project_id INT NULL,
  status               ENUM('open','promoted','cancelled') NOT NULL DEFAULT 'open',
  promoted_project_id  INT NULL,                              -- the real project once it exists; the estimate then stops counting
  notes                TEXT NULL,
  created_by           VARCHAR(200) NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_fp_status (status)
);
CREATE TABLE IF NOT EXISTS RA_forecast_stakeholders (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  forecast_id  INT NOT NULL,
  manager_name VARCHAR(200) NOT NULL,
  share_pct    DECIMAL(6,3) NOT NULL,
  UNIQUE KEY uq_fs (forecast_id, manager_name),
  CONSTRAINT fk_fs_forecast FOREIGN KEY (forecast_id) REFERENCES RA_forecast_projects(forecast_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS RA_forecast_milestones (          -- milestone dates of an estimate; each one pins a point of the bucket curve to that date (time-shift)
  id             INT AUTO_INCREMENT PRIMARY KEY,
  forecast_id    INT NOT NULL,
  milestone_name VARCHAR(100) NOT NULL,
  milestone_date DATE NOT NULL,
  UNIQUE KEY uq_fm (forecast_id, milestone_name),
  CONSTRAINT fk_fm_forecast FOREIGN KEY (forecast_id) REFERENCES RA_forecast_projects(forecast_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS RA_forecast_eligibility (        -- Yes / Expert ticks on placeholders (RA_resource_eligibility has an FK to RA_projects)
  id          INT AUTO_INCREMENT PRIMARY KEY,
  forecast_id INT NOT NULL,
  person_id   INT NOT NULL,
  capability  ENUM('yes','no','expert') NOT NULL DEFAULT 'yes',
  set_by      VARCHAR(255) NULL,
  set_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fe (person_id, forecast_id),
  CONSTRAINT fk_fe_forecast FOREIGN KEY (forecast_id) REFERENCES RA_forecast_projects(forecast_id) ON DELETE CASCADE
);
