import JSZip from "jszip";
import ExcelJS from "exceljs";
import { chromium } from "playwright";

export async function makeDocx(paragraphs: string[]) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

export async function makePptx(slides: string[][]) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  slides.forEach((lines, i) => {
    const paras = lines.map((l) => `<a:p><a:r><a:t>${l.replace(/&/g, "&amp;")}</a:t></a:r></a:p>`).join("");
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>${paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  });
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

export async function makeXlsx(rows: string[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function makePdf(pages: string[]) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const html = pages.map((p, i) => `<div style="${i ? "page-break-before:always" : ""}">${p.split("\n").map((l) => `<p>${l}</p>`).join("")}</div>`).join("");
    await page.setContent(`<html><body style="font-family:sans-serif">${html}</body></html>`);
    return Buffer.from(await page.pdf({ format: "A4" }));
  } finally {
    await browser.close();
  }
}

/** 1×1 PNG */
export const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
