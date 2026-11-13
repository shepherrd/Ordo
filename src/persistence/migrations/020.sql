CREATE TABLE alternative_plans (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id),
  source_operation_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  baseline_hash TEXT NOT NULL,
  document TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE INDEX alternative_source ON alternative_plans(source_operation_id, source_revision);
CREATE INDEX alternative_baseline ON alternative_plans(baseline_hash);
CREATE TRIGGER immutable_alternative_plans_UPDATE BEFORE UPDATE ON alternative_plans
BEGIN SELECT RAISE(ABORT,'Alternative origins are immutable'); END;
CREATE TRIGGER immutable_alternative_plans_DELETE BEFORE DELETE ON alternative_plans
WHEN ordo_permanent_delete_allowed('alternative_plans',json_array(OLD.operation_id)) != 1
BEGIN SELECT RAISE(ABORT,'Alternative origins are immutable'); END;
