-- Additive history extensions. Existing publication/export documents stay byte-for-byte intact.
CREATE TABLE revision_approvals (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK(scope='OPORD'),
  origin TEXT NOT NULL CHECK(origin IN ('explicit-approval','legacy-publication')),
  document TEXT NOT NULL CHECK(json_valid(document)),
  UNIQUE(operation_id, source_revision, id),
  FOREIGN KEY(operation_id, source_revision) REFERENCES operation_revisions(operation_id, revision)
);
CREATE UNIQUE INDEX one_explicit_approval ON revision_approvals(operation_id, source_revision, scope)
  WHERE origin='explicit-approval';
CREATE TABLE publication_approvals (
  publication_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  approval_id TEXT NOT NULL,
  FOREIGN KEY(operation_id, publication_id) REFERENCES publications(operation_id, id),
  FOREIGN KEY(operation_id, source_revision, approval_id) REFERENCES revision_approvals(operation_id, source_revision, id)
);
CREATE TABLE render_template_versions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  document TEXT NOT NULL CHECK(json_valid(document)),
  PRIMARY KEY(id, version)
);
INSERT INTO render_template_versions VALUES
 ('40000000-0000-4000-8000-000000000001',1,'{"schemaVersion":1,"id":"40000000-0000-4000-8000-000000000001","version":1,"name":"Full OPORD","product":"opord","layout":"order-sections","accent":"#2b655e"}'),
 ('40000000-0000-4000-8000-000000000002',1,'{"schemaVersion":1,"id":"40000000-0000-4000-8000-000000000002","version":1,"name":"Communications Card","product":"communications-card","layout":"signal-card","accent":"#2b655e"}');
CREATE TABLE export_templates (
  export_id TEXT PRIMARY KEY REFERENCES exports(id),
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  FOREIGN KEY(template_id, template_version) REFERENCES render_template_versions(id, version)
);
INSERT INTO export_templates
 SELECT id, CASE json_extract(document,'$.profile.product') WHEN 'opord'
 THEN '40000000-0000-4000-8000-000000000001' ELSE '40000000-0000-4000-8000-000000000002' END, 1 FROM exports;
-- Capture old embedded approval evidence without claiming it was an explicit action.
INSERT INTO revision_approvals
 SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
 operation_id,source_revision,'OPORD','legacy-publication',document FROM publications;
UPDATE revision_approvals SET document=json_object('schemaVersion',1,'id',id,'operationId',operation_id,
 'sourceRevision',source_revision,'scope',scope,'origin',origin,
 'actor',json_extract(document,'$.approval.actor'),'at',json_extract(document,'$.approval.at'),
 'note',json_extract(document,'$.approval.note'));
INSERT INTO publication_approvals
 SELECT p.id,p.operation_id,p.source_revision,a.id FROM publications p JOIN revision_approvals a
 ON a.operation_id=p.operation_id AND a.source_revision=p.source_revision
 AND json_extract(a.document,'$.at')=json_extract(p.document,'$.approval.at');

CREATE TRIGGER publication_requires_approval BEFORE INSERT ON publications BEGIN
 SELECT CASE WHEN json_extract(NEW.document,'$.schemaVersion') IS NOT 2 OR NOT EXISTS (
  SELECT 1 FROM revision_approvals a WHERE a.id=json_extract(NEW.document,'$.approvalId')
  AND a.operation_id=NEW.operation_id AND a.source_revision=NEW.source_revision
  AND a.scope='OPORD' AND a.origin='explicit-approval'
  AND json_extract(a.document,'$.actor')=json_extract(NEW.document,'$.approval.actor')
  AND json_extract(a.document,'$.at')=json_extract(NEW.document,'$.approval.at')
  AND json_extract(a.document,'$.note')=json_extract(NEW.document,'$.approval.note')
 ) THEN RAISE(ABORT,'Publication requires exact revision approval') END;
END;
CREATE TRIGGER bind_publication_approval AFTER INSERT ON publications BEGIN
 INSERT INTO publication_approvals VALUES(NEW.id,NEW.operation_id,NEW.source_revision,json_extract(NEW.document,'$.approvalId'));
END;
CREATE TRIGGER export_requires_template BEFORE INSERT ON exports BEGIN
 SELECT CASE WHEN json_extract(NEW.document,'$.schemaVersion') IS NOT 2 OR NOT EXISTS (
  SELECT 1 FROM render_template_versions t
  WHERE t.id=json_extract(NEW.document,'$.renderTemplateId') AND t.version=json_extract(NEW.document,'$.renderTemplateVersion')
  AND json_extract(t.document,'$.product')=json_extract(NEW.document,'$.profile.product')
 ) THEN RAISE(ABORT,'Export requires exact render template version') END;
END;
CREATE TRIGGER bind_export_template AFTER INSERT ON exports BEGIN
 INSERT INTO export_templates VALUES(NEW.id,json_extract(NEW.document,'$.renderTemplateId'),json_extract(NEW.document,'$.renderTemplateVersion'));
END;
