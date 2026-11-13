CREATE TABLE unit_profile_families (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
CREATE TABLE unit_profile_versions (
 id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES unit_profile_families(id),
 content_version INTEGER NOT NULL CHECK(content_version>0), status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED')),
 document TEXT NOT NULL CHECK(json_valid(document)), content_hash TEXT NOT NULL,
 UNIQUE(family_id,id)
);
CREATE UNIQUE INDEX unit_profile_version_labels ON unit_profile_versions(family_id,json_extract(document,'$.versionLabel'));
CREATE INDEX unit_profile_browse ON unit_profile_versions(status,json_extract(document,'$.identity.echelon'),json_extract(document,'$.updatedAt'));
CREATE TABLE unit_profile_retirements(version_id TEXT PRIMARY KEY REFERENCES unit_profile_versions(id),retired_at TEXT NOT NULL);
CREATE TABLE unit_profile_relationships (
 parent_version_id TEXT NOT NULL REFERENCES unit_profile_versions(id), id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 child_family_id TEXT NOT NULL, child_version_id TEXT NOT NULL,
 PRIMARY KEY(parent_version_id,id), UNIQUE(parent_version_id,child_family_id), UNIQUE(parent_version_id,ordinal),
 FOREIGN KEY(child_family_id,child_version_id) REFERENCES unit_profile_versions(family_id,id)
);
CREATE TRIGGER unit_profile_frozen_update BEFORE UPDATE ON unit_profile_versions WHEN OLD.status='PUBLISHED'
BEGIN SELECT RAISE(ABORT,'Published Unit Profile is immutable'); END;
CREATE TRIGGER unit_profile_no_delete BEFORE DELETE ON unit_profile_versions BEGIN SELECT RAISE(ABORT,'Unit Profile history is retained'); END;
CREATE TRIGGER unit_profile_identity BEFORE UPDATE ON unit_profile_versions WHEN NEW.id!=OLD.id OR NEW.family_id!=OLD.family_id
BEGIN SELECT RAISE(ABORT,'Unit Profile identity is stable'); END;
CREATE TRIGGER unit_profile_binding_insert BEFORE INSERT ON unit_profile_versions WHEN NEW.id!=json_extract(NEW.document,'$.unitProfileVersionId') OR NEW.family_id!=json_extract(NEW.document,'$.unitProfileFamilyId') OR NEW.status!=json_extract(NEW.document,'$.status') OR NEW.content_version!=json_extract(NEW.document,'$.contentVersion')
BEGIN SELECT RAISE(ABORT,'Unit Profile row binding mismatch'); END;
CREATE TRIGGER unit_profile_binding_update BEFORE UPDATE ON unit_profile_versions WHEN NEW.id!=json_extract(NEW.document,'$.unitProfileVersionId') OR NEW.family_id!=json_extract(NEW.document,'$.unitProfileFamilyId') OR NEW.status!=json_extract(NEW.document,'$.status') OR NEW.content_version!=json_extract(NEW.document,'$.contentVersion')
BEGIN SELECT RAISE(ABORT,'Unit Profile row binding mismatch'); END;
CREATE TRIGGER unit_relationship_insert BEFORE INSERT ON unit_profile_relationships WHEN (SELECT status FROM unit_profile_versions WHERE id=NEW.parent_version_id)!='DRAFT'
BEGIN SELECT RAISE(ABORT,'Published standing relationships are immutable'); END;
CREATE TRIGGER unit_relationship_update BEFORE UPDATE ON unit_profile_relationships BEGIN SELECT RAISE(ABORT,'Replace draft relationship index atomically'); END;
CREATE TRIGGER unit_relationship_delete BEFORE DELETE ON unit_profile_relationships WHEN (SELECT status FROM unit_profile_versions WHERE id=OLD.parent_version_id)!='DRAFT'
BEGIN SELECT RAISE(ABORT,'Published standing relationships are immutable'); END;
CREATE TRIGGER unit_retirement_insert BEFORE INSERT ON unit_profile_retirements WHEN (SELECT status FROM unit_profile_versions WHERE id=NEW.version_id)!='PUBLISHED'
BEGIN SELECT RAISE(ABORT,'Only published Unit Profiles may be retired'); END;
CREATE TRIGGER unit_retirement_update BEFORE UPDATE ON unit_profile_retirements BEGIN SELECT RAISE(ABORT,'Retirement history is immutable'); END;
CREATE TRIGGER unit_retirement_delete BEFORE DELETE ON unit_profile_retirements BEGIN SELECT RAISE(ABORT,'Retirement history is immutable'); END;
CREATE TRIGGER unit_family_update BEFORE UPDATE ON unit_profile_families BEGIN SELECT RAISE(ABORT,'Unit Profile family identity is immutable'); END;
CREATE TRIGGER unit_family_delete BEFORE DELETE ON unit_profile_families BEGIN SELECT RAISE(ABORT,'Unit Profile families are retained'); END;

CREATE TABLE managed_assets_m5 (
 id TEXT PRIMARY KEY, operation_id TEXT REFERENCES operations(id), doctrine_version_id TEXT REFERENCES doctrine_versions(id),
 document TEXT NOT NULL CHECK(json_valid(document)), bytes BLOB NOT NULL,
 unit_profile_version_id TEXT REFERENCES unit_profile_versions(id),
 CHECK((operation_id IS NOT NULL)+(doctrine_version_id IS NOT NULL)+(unit_profile_version_id IS NOT NULL)=1)
);
INSERT INTO managed_assets_m5(id,operation_id,doctrine_version_id,document,bytes) SELECT id,operation_id,doctrine_version_id,document,bytes FROM managed_assets;
DROP TABLE managed_assets;
ALTER TABLE managed_assets_m5 RENAME TO managed_assets;
CREATE TRIGGER immutable_managed_assets_UPDATE BEFORE UPDATE ON managed_assets BEGIN SELECT RAISE(ABORT,'History is immutable'); END;
CREATE TRIGGER immutable_managed_assets_DELETE BEFORE DELETE ON managed_assets BEGIN SELECT RAISE(ABORT,'History is immutable'); END;
CREATE TRIGGER doctrine_asset_insert BEFORE INSERT ON managed_assets WHEN NEW.doctrine_version_id IS NOT NULL AND (SELECT status FROM doctrine_versions WHERE id=NEW.doctrine_version_id)!='DRAFT'
BEGIN SELECT RAISE(ABORT,'Import assets before publishing doctrine'); END;
CREATE TRIGGER unit_profile_asset_insert BEFORE INSERT ON managed_assets WHEN NEW.unit_profile_version_id IS NOT NULL AND (SELECT status FROM unit_profile_versions WHERE id=NEW.unit_profile_version_id)!='DRAFT'
BEGIN SELECT RAISE(ABORT,'Import assets before publishing Unit Profile'); END;

CREATE TABLE operation_unit_profile_pins (
 operation_id TEXT NOT NULL, revision INTEGER NOT NULL, family_id TEXT NOT NULL, version_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 PRIMARY KEY(operation_id,revision), FOREIGN KEY(operation_id,revision) REFERENCES operation_revisions(operation_id,revision),
 FOREIGN KEY(family_id,version_id) REFERENCES unit_profile_versions(family_id,id)
);
CREATE TRIGGER operation_unit_profile_pin AFTER INSERT ON operation_revisions WHEN json_type(NEW.snapshot,'$.operationOrganizationBinding')='object' BEGIN
 INSERT INTO operation_unit_profile_pins VALUES(NEW.operation_id,NEW.revision,json_extract(NEW.snapshot,'$.operationOrganizationBinding.unitProfileFamilyId'),json_extract(NEW.snapshot,'$.operationOrganizationBinding.unitProfileVersionId'),json_extract(NEW.snapshot,'$.operationOrganizationBinding.contentHash'));
END;
CREATE TRIGGER unit_pin_update BEFORE UPDATE ON operation_unit_profile_pins BEGIN SELECT RAISE(ABORT,'Operation organization pin is immutable'); END;
CREATE TRIGGER unit_pin_delete BEFORE DELETE ON operation_unit_profile_pins BEGIN SELECT RAISE(ABORT,'Operation organization pin is immutable'); END;
CREATE INDEX operation_updated ON operations(json_extract(document,'$.updatedAt'));
CREATE INDEX review_lifecycle ON change_review_events(review_id, json_extract(document,'$.action.type'), sequence);
