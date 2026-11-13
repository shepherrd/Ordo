import ExcelJS from "exceljs";
import { fromBuffer } from "yauzl";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import {
  importFileSchema,
  type ImportFile,
  type ImportTable,
} from "../domain/table-import";

/** Check both declared and actual decompressed sizes before handing the workbook to its parser. */
export async function checkWorkbookArchive(bytes: Buffer) {
  await new Promise<void>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? Error("Invalid workbook archive."));
          return;
        }
        let entries = 0,
          total = 0,
          actual = 0,
          failed = false;
        const fail = (e: Error) => {
          if (!failed) {
            failed = true;
            zip.close();
            reject(e);
          }
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!failed) resolve();
        });
        zip.on("entry", (entry) => {
          if (
            ++entries > 2000 ||
            (total += entry.uncompressedSize) > 50 * 1024 * 1024 ||
            entry.uncompressedSize > 20 * 1024 * 1024 ||
            entry.isEncrypted() ||
            /vbaProject\.bin$|^xl\/externalLinks\//i.test(entry.fileName)
          ) {
            fail(
              Error(
                "Workbook is encrypted, contains external links/macros, or exceeds import limits.",
              ),
            );
            return;
          }
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) {
              fail(e ?? Error("Cannot read workbook entry."));
              return;
            }
            stream.on("error", fail);
            stream.on("data", (chunk) => {
              actual += chunk.length;
              if (actual > 50 * 1024 * 1024) {
                stream.destroy();
                fail(Error("Expanded workbook exceeds 50 MiB."));
              }
            });
            stream.on("end", () => {
              if (!failed) zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
}
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let value = "",
    quoted = false,
    closed = false;
  const field = () => {
    if (value.length > 40000) throw Error("A cell exceeds 40,000 characters.");
    row.push(value);
    value = "";
    closed = false;
    if (row.length > 64) throw Error("Import supports up to 64 columns.");
  };
  const line = () => {
    field();
    rows.push(row.splice(0));
    if (rows.length > 1001)
      throw Error("Import supports up to 1,000 data rows.");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
    } else if (c === delimiter) field();
    else if (c === "\r" || c === "\n") {
      line();
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else if (c === '"' && !value && !closed) quoted = true;
    else {
      if (closed) throw Error("Unexpected text after a quoted cell.");
      value += c;
    }
    if (value.length > 40000) throw Error("A cell exceeds 40,000 characters.");
  }
  if (quoted) throw Error("A quoted cell is not closed.");
  if (value || row.length || closed) line();
  return rows;
}
export async function readImportFile(
  filename: string,
  bytes: Buffer,
): Promise<ImportFile> {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw Error("Choose a nonempty file no larger than 10 MiB.");
  const ext = extname(filename).toLowerCase();
  let tables: ImportTable[];
  if (ext === ".csv" || ext === ".tsv") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "");
    } catch {
      throw Error("Save this text file as UTF-8 before importing.");
    }
    if (text.includes("\0"))
      throw Error("The text file contains invalid null characters.");
    tables = [
      {
        name: "Table",
        rows: parseDelimited(text, ext === ".tsv" ? "\t" : ","),
        warnings: [],
      },
    ];
  } else if (ext === ".xlsx") {
    await checkWorkbookArchive(bytes);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(
      bytes as unknown as Parameters<typeof book.xlsx.load>[0],
    );
    if (book.worksheets.length > 20)
      throw Error("Import supports up to 20 worksheets.");
    tables = book.worksheets
      .map((sheet) => {
        if (sheet.rowCount > 1001 || sheet.columnCount > 64)
          throw Error(
            `${sheet.name}: import supports up to 1,000 data rows and 64 columns.`,
          );
        const warnings: string[] = [],
          rows: string[][] = [];
        for (let r = 1; r <= sheet.rowCount; r++) {
          const row: string[] = [];
          for (let c = 1; c <= sheet.columnCount; c++) {
            const cell = sheet.getCell(r, c),
              v = cell.value;
            if (cell.isMerged)
              throw Error(
                `${sheet.name}, row ${r}: unmerge cells before importing.`,
              );
            if (
              v &&
              typeof v === "object" &&
              ("formula" in v || "sharedFormula" in v)
            )
              throw Error(
                `${sheet.name}, row ${r}: replace formulas with values before importing.`,
              );
            if (v && typeof v === "object" && "error" in v)
              throw Error(
                `${sheet.name}, row ${r}: correct the spreadsheet error before importing.`,
              );
            const value =
              v instanceof Date
                ? v.toISOString()
                : v == null
                  ? ""
                  : typeof v === "object" && "richText" in v
                    ? v.richText.map((x) => x.text).join("")
                    : typeof v === "object" && "text" in v
                      ? v.text
                      : String(v);
            if (value.length > 40000)
              throw Error(
                `${sheet.name}, row ${r}: a cell exceeds 40,000 characters.`,
              );
            row.push(value);
          }
          rows.push(row);
        }
        if (sheet.state !== "visible")
          warnings.push("This worksheet is hidden in the source workbook.");
        return { name: sheet.name, rows, warnings };
      })
      .filter((t) => t.rows.length);
  } else throw Error("Choose an XLSX, UTF-8 CSV, or TSV file.");
  if (!tables.length) throw Error("The file contains no tables.");
  return importFileSchema.parse({
    filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    tables,
  });
}
