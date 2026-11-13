-- Local working copies are separate from immutable planning/review history.
-- A backup carries only its own recovery copies. Restore replaces this table
-- along with the selected workspace; no previous-workspace edits are merged.
CREATE TABLE working_drafts (
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  document TEXT NOT NULL CHECK (json_valid(document)),
  PRIMARY KEY (kind, source_id)
);
CREATE TABLE working_draft_clock (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL);
INSERT INTO working_draft_clock VALUES(1,0);

-- Exact PDF bytes and the source HTML/export identity are retained together.
CREATE TABLE document_exports (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  source_export_id TEXT NOT NULL REFERENCES exports(id),
  document TEXT NOT NULL CHECK (json_valid(document)),
  bytes BLOB NOT NULL
);
CREATE TRIGGER immutable_document_exports_UPDATE BEFORE UPDATE ON document_exports
BEGIN SELECT RAISE(ABORT, 'Document exports are immutable'); END;
CREATE TRIGGER immutable_document_exports_DELETE BEFORE DELETE ON document_exports
BEGIN SELECT RAISE(ABORT, 'Document exports are immutable'); END;
