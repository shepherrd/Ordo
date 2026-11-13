-- Explicit permanent deletion is limited to exact rows authorized on the active
-- connection for one transaction. Normal history UPDATE/DELETE protections remain.
-- Earlier migrations and stored content are unchanged. No authorization persists.

DROP TRIGGER "frozen_doctrine_delete";
CREATE TRIGGER "frozen_doctrine_delete" BEFORE DELETE ON "doctrine_versions"
WHEN ordo_permanent_delete_allowed('doctrine_versions',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'Doctrine versions cannot be deleted'); END;

DROP TRIGGER "immutable_audit_events_DELETE";
CREATE TRIGGER "immutable_audit_events_DELETE" BEFORE DELETE ON "audit_events"
WHEN ordo_permanent_delete_allowed('audit_events',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_change_review_changes_DELETE";
CREATE TRIGGER "immutable_change_review_changes_DELETE" BEFORE DELETE ON "change_review_changes"
WHEN ordo_permanent_delete_allowed('change_review_changes',json_array(OLD."review_id",OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_change_review_events_DELETE";
CREATE TRIGGER "immutable_change_review_events_DELETE" BEFORE DELETE ON "change_review_events"
WHEN ordo_permanent_delete_allowed('change_review_events',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_doctrine_nodes_DELETE";
CREATE TRIGGER "immutable_doctrine_nodes_DELETE" BEFORE DELETE ON "doctrine_nodes"
WHEN ordo_permanent_delete_allowed('doctrine_nodes',json_array(OLD."profile_id",OLD."profile_version",OLD."node_id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_doctrine_retirements_DELETE";
CREATE TRIGGER "immutable_doctrine_retirements_DELETE" BEFORE DELETE ON "doctrine_retirements"
WHEN ordo_permanent_delete_allowed('doctrine_retirements',json_array(OLD."version_id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_document_exports_DELETE";
CREATE TRIGGER "immutable_document_exports_DELETE" BEFORE DELETE ON "document_exports"
WHEN ordo_permanent_delete_allowed('document_exports',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'Document exports are immutable'); END;

DROP TRIGGER "immutable_export_profile_versions_DELETE";
CREATE TRIGGER "immutable_export_profile_versions_DELETE" BEFORE DELETE ON "export_profile_versions"
WHEN ordo_permanent_delete_allowed('export_profile_versions',json_array(OLD."id",OLD."version")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_export_templates_DELETE";
CREATE TRIGGER "immutable_export_templates_DELETE" BEFORE DELETE ON "export_templates"
WHEN ordo_permanent_delete_allowed('export_templates',json_array(OLD."export_id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_exports_DELETE";
CREATE TRIGGER "immutable_exports_DELETE" BEFORE DELETE ON "exports"
WHEN ordo_permanent_delete_allowed('exports',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_graphic_export_profile_versions_DELETE";
CREATE TRIGGER "immutable_graphic_export_profile_versions_DELETE" BEFORE DELETE ON "graphic_export_profile_versions"
WHEN ordo_permanent_delete_allowed('graphic_export_profile_versions',json_array(OLD."id",OLD."version")) != 1
BEGIN SELECT RAISE(ABORT,'M6 history is immutable'); END;

DROP TRIGGER "immutable_graphic_exports_DELETE";
CREATE TRIGGER "immutable_graphic_exports_DELETE" BEFORE DELETE ON "graphic_exports"
WHEN ordo_permanent_delete_allowed('graphic_exports',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'M6 history is immutable'); END;

DROP TRIGGER "immutable_library_exchange_imports_delete";
CREATE TRIGGER "immutable_library_exchange_imports_delete" BEFORE DELETE ON "library_exchange_imports"
WHEN ordo_permanent_delete_allowed('library_exchange_imports',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Exchange import evidence is retained'); END;

DROP TRIGGER "immutable_managed_assets_DELETE";
CREATE TRIGGER "immutable_managed_assets_DELETE" BEFORE DELETE ON "managed_assets"
WHEN ordo_permanent_delete_allowed('managed_assets',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'History is immutable'); END;

DROP TRIGGER "immutable_operation_orbat_imports_DELETE";
CREATE TRIGGER "immutable_operation_orbat_imports_DELETE" BEFORE DELETE ON "operation_orbat_imports"
WHEN ordo_permanent_delete_allowed('operation_orbat_imports',json_array(OLD."operation_id",OLD."import_id")) != 1
BEGIN SELECT RAISE(ABORT,'M6 history is immutable'); END;

DROP TRIGGER "immutable_operation_revisions_DELETE";
CREATE TRIGGER "immutable_operation_revisions_DELETE" BEFORE DELETE ON "operation_revisions"
WHEN ordo_permanent_delete_allowed('operation_revisions',json_array(OLD."operation_id",OLD."revision")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_operation_symbology_source_pins_DELETE";
CREATE TRIGGER "immutable_operation_symbology_source_pins_DELETE" BEFORE DELETE ON "operation_symbology_source_pins"
WHEN ordo_permanent_delete_allowed('operation_symbology_source_pins',json_array(OLD."operation_id",OLD."revision",OLD."unit_id",OLD."source_path")) != 1
BEGIN SELECT RAISE(ABORT,'M6 history is immutable'); END;

DROP TRIGGER "immutable_profile_versions_DELETE";
CREATE TRIGGER "immutable_profile_versions_DELETE" BEFORE DELETE ON "profile_versions"
WHEN ordo_permanent_delete_allowed('profile_versions',json_array(OLD."kind",OLD."id",OLD."version")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_publication_approvals_DELETE";
CREATE TRIGGER "immutable_publication_approvals_DELETE" BEFORE DELETE ON "publication_approvals"
WHEN ordo_permanent_delete_allowed('publication_approvals',json_array(OLD."publication_id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_publications_DELETE";
CREATE TRIGGER "immutable_publications_DELETE" BEFORE DELETE ON "publications"
WHEN ordo_permanent_delete_allowed('publications',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_render_template_versions_DELETE";
CREATE TRIGGER "immutable_render_template_versions_DELETE" BEFORE DELETE ON "render_template_versions"
WHEN ordo_permanent_delete_allowed('render_template_versions',json_array(OLD."id",OLD."version")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_revision_approvals_DELETE";
CREATE TRIGGER "immutable_revision_approvals_DELETE" BEFORE DELETE ON "revision_approvals"
WHEN ordo_permanent_delete_allowed('revision_approvals',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_revision_identities_DELETE";
CREATE TRIGGER "immutable_revision_identities_DELETE" BEFORE DELETE ON "revision_identities"
WHEN ordo_permanent_delete_allowed('revision_identities',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;

DROP TRIGGER "immutable_saved_orbat_families_DELETE";
CREATE TRIGGER "immutable_saved_orbat_families_DELETE" BEFORE DELETE ON "saved_orbat_families"
WHEN ordo_permanent_delete_allowed('saved_orbat_families',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Library history is immutable'); END;

DROP TRIGGER "immutable_saved_orbat_retirements_DELETE";
CREATE TRIGGER "immutable_saved_orbat_retirements_DELETE" BEFORE DELETE ON "saved_orbat_retirements"
WHEN ordo_permanent_delete_allowed('saved_orbat_retirements',json_array(OLD."version_id")) != 1
BEGIN SELECT RAISE(ABORT,'Library history is immutable'); END;

DROP TRIGGER "immutable_saved_symbol_families_DELETE";
CREATE TRIGGER "immutable_saved_symbol_families_DELETE" BEFORE DELETE ON "saved_symbol_families"
WHEN ordo_permanent_delete_allowed('saved_symbol_families',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Library history is immutable'); END;

DROP TRIGGER "immutable_saved_symbol_retirements_DELETE";
CREATE TRIGGER "immutable_saved_symbol_retirements_DELETE" BEFORE DELETE ON "saved_symbol_retirements"
WHEN ordo_permanent_delete_allowed('saved_symbol_retirements',json_array(OLD."version_id")) != 1
BEGIN SELECT RAISE(ABORT,'Library history is immutable'); END;

DROP TRIGGER "review_header_delete";
CREATE TRIGGER "review_header_delete" BEFORE DELETE ON "change_reviews"
WHEN ordo_permanent_delete_allowed('change_reviews',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Review history is immutable'); END;

DROP TRIGGER "saved_orbat_frozen_delete";
CREATE TRIGGER "saved_orbat_frozen_delete" BEFORE DELETE ON "saved_orbat_versions"
WHEN (OLD.status='PUBLISHED') AND ordo_permanent_delete_allowed('saved_orbat_versions',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Published library version is retained'); END;

DROP TRIGGER "saved_orbat_reference_pins_delete";
CREATE TRIGGER "saved_orbat_reference_pins_delete" BEFORE DELETE ON "saved_orbat_reference_pins"
WHEN ((SELECT status FROM saved_orbat_versions WHERE id=OLD.owner_version_id)!='DRAFT') AND ordo_permanent_delete_allowed('saved_orbat_reference_pins',json_array(OLD."owner_version_id",OLD."source_path")) != 1
BEGIN SELECT RAISE(ABORT,'Published reference pins are immutable'); END;

DROP TRIGGER "saved_symbol_frozen_delete";
CREATE TRIGGER "saved_symbol_frozen_delete" BEFORE DELETE ON "saved_symbol_versions"
WHEN (OLD.status='PUBLISHED') AND ordo_permanent_delete_allowed('saved_symbol_versions',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Published library version is retained'); END;

DROP TRIGGER "unit_family_delete";
CREATE TRIGGER "unit_family_delete" BEFORE DELETE ON "unit_profile_families"
WHEN ordo_permanent_delete_allowed('unit_profile_families',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Unit Profile families are retained'); END;

DROP TRIGGER "unit_pin_delete";
CREATE TRIGGER "unit_pin_delete" BEFORE DELETE ON "operation_unit_profile_pins"
WHEN ordo_permanent_delete_allowed('operation_unit_profile_pins',json_array(OLD."operation_id",OLD."revision")) != 1
BEGIN SELECT RAISE(ABORT,'Operation organization pin is immutable'); END;

DROP TRIGGER "unit_profile_no_delete";
CREATE TRIGGER "unit_profile_no_delete" BEFORE DELETE ON "unit_profile_versions"
WHEN ordo_permanent_delete_allowed('unit_profile_versions',json_array(OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Unit Profile history is retained'); END;

DROP TRIGGER "unit_profile_symbol_pins_delete";
CREATE TRIGGER "unit_profile_symbol_pins_delete" BEFORE DELETE ON "unit_profile_symbol_pins"
WHEN ((SELECT status FROM unit_profile_versions WHERE id=OLD.owner_version_id)!='DRAFT') AND ordo_permanent_delete_allowed('unit_profile_symbol_pins',json_array(OLD."owner_version_id")) != 1
BEGIN SELECT RAISE(ABORT,'Published reference pins are immutable'); END;

DROP TRIGGER "unit_relationship_delete";
CREATE TRIGGER "unit_relationship_delete" BEFORE DELETE ON "unit_profile_relationships"
WHEN ((SELECT status FROM unit_profile_versions WHERE id=OLD.parent_version_id)!='DRAFT') AND ordo_permanent_delete_allowed('unit_profile_relationships',json_array(OLD."parent_version_id",OLD."id")) != 1
BEGIN SELECT RAISE(ABORT,'Published standing relationships are immutable'); END;

DROP TRIGGER "unit_retirement_delete";
CREATE TRIGGER "unit_retirement_delete" BEFORE DELETE ON "unit_profile_retirements"
WHEN ordo_permanent_delete_allowed('unit_profile_retirements',json_array(OLD."version_id")) != 1
BEGIN SELECT RAISE(ABORT,'Retirement history is immutable'); END;

CREATE TRIGGER operation_permanent_delete_guard BEFORE DELETE ON operations
WHEN ordo_permanent_delete_allowed('operations',json_array(OLD.id)) != 1
BEGIN SELECT RAISE(ABORT,'Use the confirmed permanent deletion command'); END;
