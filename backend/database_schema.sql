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
  version_id    INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT NOT NULL,
  version_status ENUM('draft','submitted','locked','bu_approved') DEFAULT 'draft',
  submitted_by  VARCHAR(255) NULL,
  submitted_at  DATETIME NULL,
  scope_notes   TEXT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES RA_projects(project_id) ON DELETE CASCADE
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

SET FOREIGN_KEY_CHECKS = 1;
