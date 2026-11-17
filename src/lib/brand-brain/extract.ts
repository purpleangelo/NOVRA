import path from "node:path";

export const DOC_TYPES: Record<string, { mime: string; kind: "text" | "image" }> = {
  ".pdf": { mime: "application/pdf", kind: "text" },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "text" },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "text" },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "text" },
  ".csv": { mime: "text/csv", kind: "text" },
  ".txt": { mime: "text/plain", kind: "text" },
  ".md": { mime: "text/markdown", kind: "text" },
  ".png": { mime: "image/png", kind: "image" },
  ".jpg": { mime: "image/jpeg", kind: "image" },
  ".jpeg": { mime: "image/jpeg", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
};
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class UploadError extends Error {}

/** Validates name, size and content signature. Returns the normalised type. */
export function validateUpload(fileName: string, bytes: Buffer) {
  const ext = path.extname(fileName).toLowerCase();
  const type = DOC_TYPES[ext];
  if (!type) throw new UploadError(`"${fileName}": file type ${ext || "(none)"} is not supported. Use PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, PNG, JPG or WEBP.`);
  if (bytes.length === 0) throw new UploadError(`"${fileName}" is empty.`);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError(`"${fileName}" is larger than 25 MB.`);
  const sig = (s: string) => bytes.subarray(0, s.length).toString("latin1") === s;
  const ok =
    ext === ".pdf"
      ? sig("%PDF")
      : [".docx", ".pptx", ".xlsx"].includes(ext)
        ? sig("PK\x03\x04")
        : ext === ".png"
          ? sig("\x89PNG")
          : ext === ".jpg" || ext === ".jpeg"
            ? bytes[0] === 0xff && bytes[1] === 0xd8
            : ext === ".webp"
              ? sig("RIFF") && bytes.subarray(8, 12).toString("latin1") === "WEBP"
              : !bytes.subarray(0, 4096).includes(0); // text files: no NUL bytes
  if (!ok) throw new UploadError(`"${fileName}" does not look like a valid ${ext.slice(1).toUpperCase()} file.`);
  return { ext, ...type };
}

export type Page = { page: number; text: string };

/** Extracts text per page (PDF pages, PPTX slides, XLSX sheets; one page for other text files). */
export async function extractPages(ext: string, bytes: Buffer): Promise<Page[]> {
  switch (ext) {
    case ".pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(bytes) });
      try {
        const res = await parser.getText();
        return res.pages.map((p) => ({ page: p.num, text: p.text.trim() }));
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
    case ".docx": {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: bytes });
      return [{ page: 1, text: res.value.trim() }];
    }
    case ".pptx": {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes);
      const slides = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
      const pages: Page[] = [];
      for (const [i, f] of slides.entries()) {
        const xml = await zip.files[f].async("string");
        const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(""));
        pages.push({ page: i + 1, text: paras.filter(Boolean).join("\n").trim() });
      }
      return pages;
    }
    case ".xlsx": {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes as unknown as ArrayBuffer);
      const pages: Page[] = [];
      wb.eachSheet((sheet, idx) => {
        const rows: string[] = [`Sheet: ${sheet.name}`];
        sheet.eachRow((row) => {
          const vals = (row.values as unknown[]).slice(1).map((v) => cellText(v));
          if (vals.some(Boolean)) rows.push(vals.join(" | "));
        });
        pages.push({ page: idx, text: rows.join("\n") });
      });
      return pages;
    }
    case ".csv":
    case ".txt":
    case ".md":
      return [{ page: 1, text: bytes.toString("utf8").replace(/^﻿/, "").trim() }];
    default:
      return [];
  }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return String(o.text);
    if ("result" in o) return String(o.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Groups pages into chunks of at most `maxChars` for the extractor. */
export function chunkPages(pages: Page[], maxChars = 40000): Page[][] {
  const chunks: Page[][] = [];
  let cur: Page[] = [];
  let size = 0;
  // A page longer than maxChars is split into several parts that keep the same page number (nothing is dropped).
  const parts = pages.flatMap((p) => {
    const out: Page[] = [];
    for (let i = 0; i < p.text.length; i += maxChars) out.push({ page: p.page, text: p.text.slice(i, i + maxChars) });
    return out;
  });
  for (const p of parts) {
    if (!p.text.trim()) continue;
    if (size + p.text.length > maxChars && cur.length) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
