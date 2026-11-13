-- Add the v5 graphical order envelope without changing historical documents.
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
 ) OR NOT EXISTS (
  SELECT 1 FROM render_template_versions t
  WHERE t.id=json_extract(NEW.document,'$.renderTemplateId') AND t.version=json_extract(NEW.document,'$.renderTemplateVersion')
  AND json_extract(t.document,'$.product')=json_extract(NEW.document,'$.profile.product')
 ) THEN RAISE(ABORT,'Export requires exact render template version and supported envelope') END;
END;
