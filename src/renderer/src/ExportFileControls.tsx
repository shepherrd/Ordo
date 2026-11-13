import { useState } from "react";
import type { PaperOptions } from "../../domain/document-exports";

export type ExportFileFormat = "HTML" | "PDF" | "DOCX";

export function PaperFields({
  options,
  onChange,
  label,
}: {
  options: PaperOptions;
  onChange: (next: PaperOptions) => void;
  label: string;
}) {
  return (
    <>
      <label>
        Paper
        <select
          aria-label={`${label} paper`}
          value={options.paper}
          onChange={(e) =>
            onChange({
              ...options,
              paper: e.target.value as PaperOptions["paper"],
            })
          }
        >
          <option>Letter</option>
          <option>A4</option>
        </select>
      </label>
      <label>
        Orientation
        <select
          aria-label={`${label} orientation`}
          value={options.orientation}
          onChange={(e) =>
            onChange({
              ...options,
              orientation: e.target.value as PaperOptions["orientation"],
            })
          }
        >
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </label>
    </>
  );
}

export function ExportFileControls({
  paper,
  onGenerate,
}: {
  paper: "a4" | "letter";
  onGenerate: (format: ExportFileFormat, options: PaperOptions) => void;
}) {
  const [format, setFormat] = useState<ExportFileFormat>("HTML");
  const [options, setOptions] = useState<PaperOptions>({
    paper: paper === "a4" ? "A4" : "Letter",
    orientation: "portrait",
  });
  return (
    <>
      <label>
        File format
        <select
          aria-label="File format"
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFileFormat)}
        >
          <option value="HTML">HTML</option>
          <option value="PDF">PDF</option>
          <option value="DOCX">Word (.docx)</option>
        </select>
      </label>
      {format !== "HTML" && (
        <PaperFields label="Export" options={options} onChange={setOptions} />
      )}
      <button className="primary" onClick={() => onGenerate(format, options)}>
        {format === "HTML"
          ? "Generate export"
          : format === "DOCX"
            ? "Export Word"
            : "Export PDF"}
      </button>
    </>
  );
}
