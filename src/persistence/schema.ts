import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
// Read mappings. Reviewed SQL migrations own constraints and immutable-history triggers.
export const operations = sqliteTable("operations", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  document: text("document").notNull(),
});
export const profileVersions = sqliteTable(
  "profile_versions",
  {
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    document: text("document").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id, t.version] })],
);
export const exportProfiles = sqliteTable(
  "export_profile_versions",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    operationId: text("operation_id").notNull(),
    document: text("document").notNull(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);
export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  version: integer("version").notNull(),
  sourceRevision: integer("source_revision").notNull(),
  supersedesId: text("supersedes_id"),
  document: text("document").notNull(),
});
export const exportsTable = sqliteTable("exports", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  sourceRevision: integer("source_revision").notNull(),
  publicationId: text("publication_id"),
  profileId: text("profile_id").notNull(),
  profileVersion: integer("profile_version").notNull(),
  document: text("document").notNull(),
});
