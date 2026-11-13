CREATE TABLE briefing_exports (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  source_revision INTEGER NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  bytes BLOB NOT NULL,
  FOREIGN KEY(operation_id,source_revision) REFERENCES operation_revisions(operation_id,revision)
);
CREATE INDEX briefing_exports_operation ON briefing_exports(operation_id);
CREATE TRIGGER immutable_briefing_exports_UPDATE BEFORE UPDATE ON briefing_exports
BEGIN SELECT RAISE(ABORT,'Retained briefings are immutable'); END;
CREATE TRIGGER immutable_briefing_exports_DELETE BEFORE DELETE ON briefing_exports
WHEN ordo_permanent_delete_allowed('briefing_exports',json_array(OLD.id)) != 1
BEGIN SELECT RAISE(ABORT,'Retained briefings are immutable'); END;
