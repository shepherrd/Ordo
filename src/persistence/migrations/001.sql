CREATE TABLE profile_versions (
 kind TEXT NOT NULL CHECK(kind IN ('doctrine','echelon','organization')),
 id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), document TEXT NOT NULL CHECK(json_valid(document)),
 PRIMARY KEY(kind,id,version)
);
CREATE TABLE operations (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
 doctrine_kind TEXT NOT NULL DEFAULT 'doctrine' CHECK(doctrine_kind='doctrine'), doctrine_id TEXT NOT NULL, doctrine_version INTEGER NOT NULL,
 organization_kind TEXT NOT NULL DEFAULT 'organization' CHECK(organization_kind='organization'), organization_id TEXT NOT NULL, organization_version INTEGER NOT NULL,
 echelon_kind TEXT NOT NULL DEFAULT 'echelon' CHECK(echelon_kind='echelon'), echelon_id TEXT NOT NULL, echelon_version INTEGER NOT NULL,
 FOREIGN KEY(doctrine_kind,doctrine_id,doctrine_version) REFERENCES profile_versions(kind,id,version),
 FOREIGN KEY(organization_kind,organization_id,organization_version) REFERENCES profile_versions(kind,id,version),
 FOREIGN KEY(echelon_kind,echelon_id,echelon_version) REFERENCES profile_versions(kind,id,version)
);
CREATE TABLE operation_revisions (
 operation_id TEXT NOT NULL REFERENCES operations(id), revision INTEGER NOT NULL,
 saved_at TEXT NOT NULL, actor TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 PRIMARY KEY(operation_id,revision)
);
CREATE TABLE units (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL, parent_id TEXT, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(operation_id,id),
 FOREIGN KEY(operation_id,parent_id) REFERENCES units(operation_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE phases (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(operation_id,id));
CREATE TABLE objectives (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(operation_id,id));
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL, unit_id TEXT, phase_id TEXT, objective_id TEXT, document TEXT NOT NULL CHECK(json_valid(document)),
 FOREIGN KEY(operation_id,unit_id) REFERENCES units(operation_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(operation_id,phase_id) REFERENCES phases(operation_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(operation_id,objective_id) REFERENCES objectives(operation_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE events (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL, relative_to_id TEXT, phase_id TEXT, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(operation_id,id),
 FOREIGN KEY(operation_id,relative_to_id) REFERENCES events(operation_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(operation_id,phase_id) REFERENCES phases(operation_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE attachments (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('annex','appendix','tab','exhibit')), parent_attachment_id TEXT,
 document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(operation_id,id),
 CHECK((kind='annex' AND parent_attachment_id IS NULL) OR (kind<>'annex' AND parent_attachment_id IS NOT NULL)),
 FOREIGN KEY(operation_id,parent_attachment_id) REFERENCES attachments(operation_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE radio_nets (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(operation_id,id));
CREATE TABLE net_participants (
 operation_id TEXT NOT NULL, net_id TEXT NOT NULL, unit_id TEXT NOT NULL, PRIMARY KEY(net_id,unit_id),
 FOREIGN KEY(operation_id,net_id) REFERENCES radio_nets(operation_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(operation_id,unit_id) REFERENCES units(operation_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE pace_plans (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), ordinal INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)));
CREATE TABLE export_profile_versions (
 id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), operation_id TEXT NOT NULL REFERENCES operations(id), document TEXT NOT NULL CHECK(json_valid(document)), PRIMARY KEY(id,version), UNIQUE(operation_id,id,version)
);
CREATE TABLE publications (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, source_revision INTEGER NOT NULL, version INTEGER NOT NULL, supersedes_id TEXT UNIQUE,
 document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(operation_id,version), UNIQUE(operation_id,id),
 FOREIGN KEY(operation_id,source_revision) REFERENCES operation_revisions(operation_id,revision),
 FOREIGN KEY(operation_id,supersedes_id) REFERENCES publications(operation_id,id)
);
CREATE TABLE exports (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, source_revision INTEGER NOT NULL, publication_id TEXT,
 profile_id TEXT NOT NULL, profile_version INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
 FOREIGN KEY(operation_id,source_revision) REFERENCES operation_revisions(operation_id,revision),
 FOREIGN KEY(operation_id,publication_id) REFERENCES publications(operation_id,id),
 FOREIGN KEY(operation_id,profile_id,profile_version) REFERENCES export_profile_versions(operation_id,id,version)
);
CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL REFERENCES operations(id), at TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE preferences (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL CHECK(json_valid(document)));
CREATE INDEX audit_operation ON audit_events(operation_id,id);
CREATE INDEX publication_operation ON publications(operation_id,version);
CREATE INDEX export_operation ON exports(operation_id);
