-- ================================================================
-- Retro Projects Cleanup — Fix duplicates + hide gap/commit/SS
-- ================================================================

SET SQL_SAFE_UPDATES = 0;

-- STEP 1: Add retro_category column to classify project types
ALTER TABLE RA_projects ADD COLUMN IF NOT EXISTS retro_category VARCHAR(20) NULL
  COMMENT 'gap | commit | ss_task — excludes from projects page; NULL = normal project';

-- If IF NOT EXISTS not supported, run:
-- ALTER TABLE RA_projects ADD COLUMN retro_category VARCHAR(20) NULL;

-- STEP 2: Fix duplicates — keep lowest project_id per project_name
-- (safe: deletes the higher-id duplicate that has no sizing versions)
DELETE p2 FROM RA_projects p1
INNER JOIN RA_projects p2
  ON p1.project_name = p2.project_name
  AND p1.project_id < p2.project_id
WHERE NOT EXISTS (
  SELECT 1 FROM RA_sizing_versions sv WHERE sv.project_id = p2.project_id
);
COMMIT;

-- STEP 3: Mark gap_ projects
UPDATE RA_projects
SET retro_category = 'gap'
WHERE project_name LIKE 'gap_%'
  AND (project_code = '' OR project_code IS NULL);

-- STEP 4: Mark commit_ projects
UPDATE RA_projects
SET retro_category = 'commit'
WHERE project_name LIKE 'commit_%'
  AND (project_code = '' OR project_code IS NULL);

-- STEP 5: Mark SS tasks (spg18.xxx) that have no sizing versions
UPDATE RA_projects
SET retro_category = 'ss_task'
WHERE project_code LIKE 'spg18.%'
  AND NOT EXISTS (
    SELECT 1 FROM RA_sizing_versions sv WHERE sv.project_id = RA_projects.project_id
  );

COMMIT;
SET SQL_SAFE_UPDATES = 1;

-- Verify counts
SELECT retro_category, COUNT(*) AS count
FROM RA_projects
GROUP BY retro_category
ORDER BY retro_category;
