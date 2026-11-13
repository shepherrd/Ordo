-- Add an immutable, version-scoped index of typed doctrine nodes. The validated
-- profile document remains the authority; this index enforces authored bindings.
CREATE TABLE doctrine_nodes (
  profile_kind TEXT NOT NULL DEFAULT 'doctrine' CHECK(profile_kind='doctrine'),
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  parent_stable_key TEXT,
  PRIMARY KEY(profile_id,profile_version,node_id),
  UNIQUE(profile_id,profile_version,stable_key),
  FOREIGN KEY(profile_kind,profile_id,profile_version) REFERENCES profile_versions(kind,id,version),
  FOREIGN KEY(profile_id,profile_version,parent_stable_key) REFERENCES doctrine_nodes(profile_id,profile_version,stable_key) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE attachments ADD COLUMN doctrine_node_id TEXT;
ALTER TABLE attachments ADD COLUMN applicability TEXT CHECK(applicability IN ('UNDECIDED','INCLUDED','OMITTED'));
CREATE UNIQUE INDEX attachment_doctrine_identity ON attachments(operation_id,doctrine_node_id) WHERE doctrine_node_id IS NOT NULL;
CREATE TRIGGER authored_product_binding_insert BEFORE INSERT ON attachments BEGIN
  SELECT CASE WHEN NEW.doctrine_node_id IS NOT json_extract(NEW.document,'$.doctrineNodeId') OR NEW.applicability IS NOT json_extract(NEW.document,'$.applicability') THEN RAISE(ABORT,'Product state does not match its typed document') END;
  SELECT CASE WHEN NEW.doctrine_node_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM doctrine_nodes n JOIN operations o ON o.id=NEW.operation_id
    WHERE n.node_id=NEW.doctrine_node_id AND n.profile_id=o.doctrine_id AND n.profile_version=o.doctrine_version
  ) THEN RAISE(ABORT,'Product must bind to the operation pinned doctrine') END;
END;
CREATE TRIGGER authored_product_binding_update BEFORE UPDATE ON attachments BEGIN
  SELECT CASE WHEN NEW.doctrine_node_id IS NOT json_extract(NEW.document,'$.doctrineNodeId') OR NEW.applicability IS NOT json_extract(NEW.document,'$.applicability') THEN RAISE(ABORT,'Product state does not match its typed document') END;
  SELECT CASE WHEN NEW.doctrine_node_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM doctrine_nodes n JOIN operations o ON o.id=NEW.operation_id
    WHERE n.node_id=NEW.doctrine_node_id AND n.profile_id=o.doctrine_id AND n.profile_version=o.doctrine_version
  ) THEN RAISE(ABORT,'Product must bind to the operation pinned doctrine') END;
END;
