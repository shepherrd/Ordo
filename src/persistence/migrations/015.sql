-- Disposable local search data; canonical records and history remain authoritative.
CREATE TABLE search_owners(owner TEXT PRIMARY KEY, source_token TEXT NOT NULL, format INTEGER NOT NULL, entry_count INTEGER NOT NULL);
CREATE TABLE search_documents(
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES search_owners(owner) ON DELETE CASCADE,
 operation_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, norm_title TEXT NOT NULL,
 norm_code TEXT NOT NULL, norm_text TEXT NOT NULL, document TEXT NOT NULL
);
CREATE INDEX search_documents_owner ON search_documents(owner);
CREATE INDEX search_documents_operation ON search_documents(operation_id,type);
CREATE VIRTUAL TABLE search_fts USING fts5(norm_title,norm_code,norm_text,content='search_documents',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER search_document_insert AFTER INSERT ON search_documents BEGIN
 INSERT INTO search_fts(rowid,norm_title,norm_code,norm_text) VALUES(NEW.rowid,NEW.norm_title,NEW.norm_code,NEW.norm_text);
END;
CREATE TRIGGER search_document_delete AFTER DELETE ON search_documents BEGIN
 INSERT INTO search_fts(search_fts,rowid,norm_title,norm_code,norm_text) VALUES('delete',OLD.rowid,OLD.norm_title,OLD.norm_code,OLD.norm_text);
END;
CREATE TRIGGER search_operation_delete AFTER DELETE ON operations BEGIN DELETE FROM search_owners WHERE owner='operation:'||OLD.id; END;
CREATE TRIGGER search_catalog_delete AFTER DELETE ON catalog_items BEGIN DELETE FROM search_owners WHERE owner='catalog:'||OLD.id; END;
CREATE TRIGGER search_asset_delete AFTER DELETE ON managed_assets BEGIN DELETE FROM search_owners WHERE owner='file:'||OLD.id; END;
