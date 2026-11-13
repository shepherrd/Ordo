-- Editable library content is separate from immutable consumed/historical snapshots.
-- Existing tables, source records, pins and migrations remain unchanged.
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('DOCTRINE','ORGANIZATION','SYMBOL','ORBAT')),
  document TEXT NOT NULL,
  edit_token TEXT NOT NULL
);
CREATE INDEX catalog_items_kind ON catalog_items(kind);
-- Import receipts survive catalog deletion so deleted entries cannot reappear on launch.
CREATE TABLE catalog_imports (
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(kind, source_id)
);
-- A snapshot is taken only when another product consumes the saved content.
CREATE TABLE catalog_snapshots (
  item_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY(item_id, content_hash)
);
CREATE TABLE catalog_asset_owners (
  item_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL UNIQUE
);
-- Original sources are retained only for compatibility and import provenance.
CREATE TABLE catalog_origins (
  item_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL
);
CREATE TRIGGER protect_catalog_imports_UPDATE BEFORE UPDATE ON catalog_imports BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
CREATE TRIGGER protect_catalog_imports_DELETE BEFORE DELETE ON catalog_imports BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
CREATE TRIGGER protect_catalog_snapshots_UPDATE BEFORE UPDATE ON catalog_snapshots BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
CREATE TRIGGER protect_catalog_snapshots_DELETE BEFORE DELETE ON catalog_snapshots BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
CREATE TRIGGER protect_catalog_asset_owners_UPDATE BEFORE UPDATE ON catalog_asset_owners BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
CREATE TRIGGER protect_catalog_asset_owners_DELETE BEFORE DELETE ON catalog_asset_owners BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
CREATE TRIGGER protect_catalog_origins_UPDATE BEFORE UPDATE ON catalog_origins BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
CREATE TRIGGER protect_catalog_origins_DELETE BEFORE DELETE ON catalog_origins BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END;
-- html-v4 adds typed narrative rendering while retaining prior export envelopes.
DROP TRIGGER export_requires_template;
CREATE TRIGGER export_requires_template BEFORE INSERT ON exports BEGIN
 SELECT CASE WHEN NOT (
  (json_extract(NEW.document,'$.schemaVersion') IS 2 AND json_extract(NEW.document,'$.projectionVersion') IS NOT 5)
  OR (json_extract(NEW.document,'$.schemaVersion') IS 3
   AND json_extract(NEW.document,'$.projectionVersion') IS 5
   AND json_extract(NEW.document,'$.rendererVersion') IS 'html-v3'
   AND json_type(NEW.document,'$.graphics') IS 'array'
   AND json_array_length(NEW.document,'$.graphics') > 0
   AND length(json_extract(NEW.document,'$.htmlHash')) IS 64)
  OR (json_extract(NEW.document,'$.schemaVersion') IS 4
   AND json_extract(NEW.document,'$.rendererVersion') IS 'html-v4'
   AND json_extract(NEW.document,'$.projectionVersion') BETWEEN 1 AND 5
   AND json_type(NEW.document,'$.graphics') IS 'array'
   AND (json_extract(NEW.document,'$.projectionVersion') IS 5) = (json_array_length(NEW.document,'$.graphics') > 0)
   AND length(json_extract(NEW.document,'$.htmlHash')) IS 64)
 ) OR NOT EXISTS (
  SELECT 1 FROM render_template_versions t
  WHERE t.id=json_extract(NEW.document,'$.renderTemplateId') AND t.version=json_extract(NEW.document,'$.renderTemplateVersion')
  AND json_extract(t.document,'$.product')=json_extract(NEW.document,'$.profile.product')
 ) THEN RAISE(ABORT,'Export requires exact render template version and supported envelope') END;
END;
