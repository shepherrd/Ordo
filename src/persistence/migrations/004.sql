CREATE TABLE doctrine_versions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK(profile_version > 0),
  content_version INTEGER NOT NULL CHECK(content_version > 0),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED')),
  document TEXT NOT NULL CHECK(json_valid(document)),
  UNIQUE(family_id, profile_version)
);
CREATE TABLE doctrine_retirements (
  version_id TEXT PRIMARY KEY REFERENCES doctrine_versions(id),
  retired_at TEXT NOT NULL
);
CREATE UNIQUE INDEX doctrine_version_labels ON doctrine_versions(family_id,json_extract(document,'$.versionLabel'));
CREATE TABLE managed_assets (
  id TEXT PRIMARY KEY,
  operation_id TEXT REFERENCES operations(id),
  doctrine_version_id TEXT REFERENCES doctrine_versions(id),
  document TEXT NOT NULL CHECK(json_valid(document)),
  bytes BLOB NOT NULL,
  CHECK((operation_id IS NULL) != (doctrine_version_id IS NULL))
);
CREATE TRIGGER frozen_doctrine_update BEFORE UPDATE ON doctrine_versions
WHEN OLD.status = 'PUBLISHED'
BEGIN SELECT RAISE(ABORT, 'Published doctrine is immutable'); END;
CREATE TRIGGER frozen_doctrine_delete BEFORE DELETE ON doctrine_versions
BEGIN SELECT RAISE(ABORT, 'Doctrine versions cannot be deleted'); END;
CREATE TRIGGER doctrine_identity_update BEFORE UPDATE ON doctrine_versions
WHEN NEW.id != OLD.id OR NEW.family_id != OLD.family_id OR NEW.profile_version != OLD.profile_version
BEGIN SELECT RAISE(ABORT, 'Doctrine identity is stable'); END;
CREATE TRIGGER doctrine_asset_insert BEFORE INSERT ON managed_assets
WHEN NEW.doctrine_version_id IS NOT NULL AND
  (SELECT status FROM doctrine_versions WHERE id=NEW.doctrine_version_id) != 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'Import assets before publishing doctrine'); END;
