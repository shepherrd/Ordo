CREATE TABLE revision_identities (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 UNIQUE(operation_id,revision), UNIQUE(operation_id,id),
 FOREIGN KEY(operation_id,revision) REFERENCES operation_revisions(operation_id,revision)
);
INSERT INTO revision_identities(id,operation_id,revision)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))), operation_id,revision FROM operation_revisions;
CREATE TRIGGER create_revision_identity AFTER INSERT ON operation_revisions BEGIN
 INSERT INTO revision_identities(id,operation_id,revision) VALUES(
 lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),NEW.operation_id,NEW.revision);
END;
CREATE TABLE change_reviews (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
 baseline_revision_id TEXT NOT NULL, target_revision_id TEXT NOT NULL,
 baseline_publication_id TEXT, target_publication_id TEXT,
 parent_review_id TEXT, supersedes_review_id TEXT,
 document TEXT NOT NULL CHECK(json_valid(document)), comparison_hash TEXT NOT NULL,
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
 UNIQUE(operation_id,id),
 FOREIGN KEY(operation_id,baseline_revision_id) REFERENCES revision_identities(operation_id,id),
 FOREIGN KEY(operation_id,target_revision_id) REFERENCES revision_identities(operation_id,id),
 FOREIGN KEY(operation_id,baseline_publication_id) REFERENCES publications(operation_id,id),
 FOREIGN KEY(operation_id,target_publication_id) REFERENCES publications(operation_id,id),
 FOREIGN KEY(operation_id,parent_review_id) REFERENCES change_reviews(operation_id,id),
 FOREIGN KEY(operation_id,supersedes_review_id) REFERENCES change_reviews(operation_id,id)
);
CREATE TABLE change_review_changes (
 review_id TEXT NOT NULL REFERENCES change_reviews(id), id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, ordinal INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
 PRIMARY KEY(review_id,id), UNIQUE(review_id,fingerprint), UNIQUE(review_id,ordinal)
);
CREATE TABLE change_review_events (
 id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES change_reviews(id),
 sequence INTEGER NOT NULL CHECK(sequence>0), change_id TEXT,
 document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(review_id,sequence),
 FOREIGN KEY(review_id,change_id) REFERENCES change_review_changes(review_id,id)
);
CREATE INDEX review_operation ON change_reviews(operation_id,id);
CREATE TRIGGER review_header_update BEFORE UPDATE ON change_reviews
WHEN OLD.sealed != 0 OR NEW.sealed != 1 OR NEW.id != OLD.id OR NEW.operation_id != OLD.operation_id
 OR NEW.document != OLD.document OR NEW.comparison_hash != OLD.comparison_hash
 OR NEW.baseline_revision_id != OLD.baseline_revision_id OR NEW.target_revision_id != OLD.target_revision_id
 OR NEW.baseline_publication_id IS NOT OLD.baseline_publication_id OR NEW.target_publication_id IS NOT OLD.target_publication_id
 OR NEW.parent_review_id IS NOT OLD.parent_review_id OR NEW.supersedes_review_id IS NOT OLD.supersedes_review_id
BEGIN SELECT RAISE(ABORT,'Review comparison is immutable'); END;
CREATE TRIGGER review_header_delete BEFORE DELETE ON change_reviews BEGIN SELECT RAISE(ABORT,'Review history is immutable'); END;
CREATE TRIGGER review_change_insert BEFORE INSERT ON change_review_changes
WHEN (SELECT sealed FROM change_reviews WHERE id=NEW.review_id) != 0
BEGIN SELECT RAISE(ABORT,'Review change set is sealed'); END;
CREATE TRIGGER review_change_identity BEFORE INSERT ON change_review_changes
WHEN NEW.id != json_extract(NEW.document,'$.changeId') OR NEW.fingerprint != json_extract(NEW.document,'$.semanticFingerprint')
BEGIN SELECT RAISE(ABORT,'Change identity mismatch'); END;
CREATE TRIGGER review_event_insert BEFORE INSERT ON change_review_events
WHEN (SELECT sealed FROM change_reviews WHERE id=NEW.review_id) != 1
 OR NEW.sequence != (SELECT count(*)+1 FROM change_review_events WHERE review_id=NEW.review_id)
 OR NEW.id != json_extract(NEW.document,'$.id') OR NEW.review_id != json_extract(NEW.document,'$.reviewId')
 OR NEW.sequence != json_extract(NEW.document,'$.sequence')
 OR NEW.change_id IS NOT json_extract(NEW.document,'$.action.changeId')
BEGIN SELECT RAISE(ABORT,'Invalid review event binding or sequence'); END;
CREATE TRIGGER review_endpoint_binding BEFORE INSERT ON change_reviews BEGIN
 SELECT CASE WHEN NEW.sealed != 0
 OR NEW.id != json_extract(NEW.document,'$.id') OR NEW.operation_id != json_extract(NEW.document,'$.operationId')
 OR NEW.baseline_revision_id != json_extract(NEW.document,'$.comparison.baseline.revisionId')
 OR NEW.target_revision_id != json_extract(NEW.document,'$.comparison.target.revisionId')
 OR NEW.baseline_publication_id IS NOT json_extract(NEW.document,'$.comparison.baseline.publicationId')
 OR NEW.target_publication_id IS NOT json_extract(NEW.document,'$.comparison.target.publicationId')
 OR (SELECT revision FROM revision_identities WHERE id=NEW.baseline_revision_id) > (SELECT revision FROM revision_identities WHERE id=NEW.target_revision_id)
 OR (NEW.baseline_publication_id IS NOT NULL AND (SELECT source_revision FROM publications WHERE id=NEW.baseline_publication_id) != (SELECT revision FROM revision_identities WHERE id=NEW.baseline_revision_id))
 OR (NEW.target_publication_id IS NOT NULL AND (SELECT source_revision FROM publications WHERE id=NEW.target_publication_id) != (SELECT revision FROM revision_identities WHERE id=NEW.target_revision_id))
 THEN RAISE(ABORT,'Invalid review endpoint binding') END;
END;
