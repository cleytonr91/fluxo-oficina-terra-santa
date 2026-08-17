import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type ReportItem = { label: string; value: string };

type FarolPdfInput = {
  monthLabel: string;
  generatedAt: string;
  summary: ReportItem[];
  goals: ReportItem[];
  operation: ReportItem[];
  observations: { label: string; text: string }[];
};

const colors = {
  ink: rgb(0.09, 0.13, 0.12),
  muted: rgb(0.36, 0.42, 0.4),
  green: rgb(0.18, 0.49, 0.33),
  pale: rgb(0.95, 0.97, 0.95),
  line: rgb(0.83, 0.87, 0.84),
};

function wrapText(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  });

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawHeader(page: PDFPage, bold: PDFFont, regular: PDFFont, monthLabel: string, generatedAt: string) {
  page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: page.getHeight() - 84, width: page.getWidth(), height: 84, color: colors.green });
  page.drawText("FAROL GERENCIAL", { x: 42, y: page.getHeight() - 42, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`Relatório mensal - ${monthLabel}`, { x: 42, y: page.getHeight() - 63, size: 10, font: regular, color: rgb(0.9, 1, 0.94) });
  page.drawText(`Gerado em ${generatedAt}`, { x: page.getWidth() - 170, y: page.getHeight() - 48, size: 8, font: regular, color: rgb(0.9, 1, 0.94) });
}

function drawSectionTitle(page: PDFPage, title: string, y: number, bold: PDFFont) {
  page.drawText(title, { x: 42, y, size: 13, font: bold, color: colors.ink });
  page.drawLine({ start: { x: 42, y: y - 7 }, end: { x: page.getWidth() - 42, y: y - 7 }, thickness: 1, color: colors.line });
}

function drawItems(page: PDFPage, items: ReportItem[], startY: number, regular: PDFFont, bold: PDFFont) {
  const columnWidth = (page.getWidth() - 96) / 2;
  items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 42 + column * (columnWidth + 12);
    const y = startY - row * 54;
    page.drawRectangle({ x, y: y - 29, width: columnWidth, height: 42, color: colors.pale, borderColor: colors.line, borderWidth: 0.7 });
    page.drawText(item.label, { x: x + 10, y: y - 2, size: 8, font: regular, color: colors.muted });
    page.drawText(item.value, { x: x + 10, y: y - 19, size: 13, font: bold, color: colors.ink });
  });
  return startY - Math.ceil(items.length / 2) * 54;
}

export async function downloadFarolPdf(input: FarolPdfInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  drawHeader(page, bold, regular, input.monthLabel, input.generatedAt);

  let y = 720;
  drawSectionTitle(page, "Resumo do período", y, bold);
  y = drawItems(page, input.summary, y - 28, regular, bold) - 24;

  drawSectionTitle(page, "Metas e resultados", y, bold);
  y = drawItems(page, input.goals, y - 28, regular, bold) - 24;

  drawSectionTitle(page, "Indicadores operacionais", y, bold);
  y = drawItems(page, input.operation, y - 28, regular, bold) - 24;

  if (y < 150) {
    const next = pdf.addPage([595, 842]);
    drawHeader(next, bold, regular, input.monthLabel, input.generatedAt);
    y = 720;
    drawSectionTitle(next, "Observações dos indicadores", y, bold);
    input.observations.forEach((item) => {
      const lines = wrapText(item.text, regular, 9, 475);
      y -= 30;
      next.drawText(item.label, { x: 52, y, size: 10, font: bold, color: colors.ink });
      y -= 16;
      lines.slice(0, 5).forEach((line) => {
        next.drawText(line, { x: 52, y, size: 9, font: regular, color: colors.muted });
        y -= 13;
      });
      next.drawLine({ start: { x: 52, y: y + 5 }, end: { x: 543, y: y + 5 }, thickness: 0.6, color: colors.line });
    });
  } else {
    drawSectionTitle(page, "Observações dos indicadores", y, bold);
    y -= 28;
    input.observations.slice(0, 4).forEach((item) => {
      const lines = wrapText(item.text, regular, 8.5, 475);
      page.drawText(item.label, { x: 52, y, size: 9, font: bold, color: colors.ink });
      y -= 14;
      lines.slice(0, 3).forEach((line) => {
        page.drawText(line, { x: 52, y, size: 8.5, font: regular, color: colors.muted });
        y -= 12;
      });
      y -= 8;
    });
  }

  const bytes = await pdf.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `farol-gerencial-${input.monthLabel.toLowerCase().replace(/\s+/g, "-")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
