CREATE TABLE whiteboard_snapshots (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  source_revision INTEGER NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  bytes BLOB NOT NULL,
  FOREIGN KEY(operation_id,source_revision) REFERENCES operation_revisions(operation_id,revision)
);
CREATE INDEX whiteboard_snapshots_operation ON whiteboard_snapshots(operation_id);
CREATE TRIGGER immutable_whiteboard_snapshots_UPDATE BEFORE UPDATE ON whiteboard_snapshots
BEGIN SELECT RAISE(ABORT,'Whiteboard snapshots are immutable'); END;
CREATE TRIGGER immutable_whiteboard_snapshots_DELETE BEFORE DELETE ON whiteboard_snapshots
WHEN ordo_permanent_delete_allowed('whiteboard_snapshots',json_array(OLD.id)) != 1
BEGIN SELECT RAISE(ABORT,'Whiteboard snapshots are immutable'); END;
CREATE TABLE whiteboard_snapshot_assets (
  asset_id TEXT PRIMARY KEY REFERENCES managed_assets(id),
  snapshot_id TEXT NOT NULL REFERENCES whiteboard_snapshots(id)
);
CREATE TRIGGER immutable_whiteboard_snapshot_assets_UPDATE BEFORE UPDATE ON whiteboard_snapshot_assets
BEGIN SELECT RAISE(ABORT,'Snapshot image origins are immutable'); END;
CREATE TRIGGER immutable_whiteboard_snapshot_assets_DELETE BEFORE DELETE ON whiteboard_snapshot_assets
WHEN ordo_permanent_delete_allowed('whiteboard_snapshot_assets',json_array(OLD.asset_id)) != 1
BEGIN SELECT RAISE(ABORT,'Snapshot image origins are immutable'); END;
