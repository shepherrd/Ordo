CREATE TABLE office_exports (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  source_revision INTEGER NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  bytes BLOB NOT NULL,
  FOREIGN KEY(operation_id,source_revision) REFERENCES operation_revisions(operation_id,revision)
);
CREATE INDEX office_exports_operation ON office_exports(operation_id);
CREATE TRIGGER immutable_office_exports_UPDATE BEFORE UPDATE ON office_exports
BEGIN SELECT RAISE(ABORT,'Retained Office exports are immutable'); END;
CREATE TRIGGER immutable_office_exports_DELETE BEFORE DELETE ON office_exports
WHEN ordo_permanent_delete_allowed('office_exports',json_array(OLD.id)) != 1
BEGIN SELECT RAISE(ABORT,'Retained Office exports are immutable'); END;
