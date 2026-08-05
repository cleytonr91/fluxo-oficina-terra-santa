import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from "pdf-lib";
import type { RoadTestFormData, RoadTestSection, VehicleFlow } from "@/types/domain";

const templateUrl = "/templates/ficha-teste-rodagem-original.pdf";
const ink = rgb(0.03, 0.08, 0.14);

function formatDate(value?: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = value.split(/\r?\n/);
  const lines: string[] = [];

  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    let current = words[0];

    words.slice(1).forEach((word) => {
      const candidate = `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    });
    lines.push(current);
  });

  return lines;
}

function drawAtTop(
  page: PDFPage,
  value: string | undefined,
  x: number,
  top: number,
  width: number,
  font: PDFFont,
  options: { size?: number; maxLines?: number; lineHeight?: number } = {},
) {
  const normalized = value?.trim();
  if (!normalized) return;
  const size = options.size ?? 5.7;
  const lineHeight = options.lineHeight ?? size + 1.2;
  const lines = wrapText(normalized, font, size, width).slice(0, options.maxLines ?? 1);

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: page.getHeight() - top - size - index * lineHeight,
      size,
      font,
      color: ink,
    });
  });
}

async function embedSignature(pdfDoc: PDFDocument, signature?: string) {
  if (!signature?.startsWith("data:image/png")) return null;
  try {
    return await pdfDoc.embedPng(signature);
  } catch {
    return null;
  }
}

function drawSignatureAtTop(page: PDFPage, image: PDFImage | null, x: number, top: number, width: number, height: number) {
  if (!image) return;
  const scaled = image.scaleToFit(width, height);
  page.drawImage(image, {
    x: x + (width - scaled.width) / 2,
    y: page.getHeight() - top - height + (height - scaled.height) / 2,
    width: scaled.width,
    height: scaled.height,
  });
}

function drawTripFields(page: PDFPage, section: RoadTestSection, top: number, font: PDFFont) {
  drawAtTop(page, formatDate(section.date), 72, top, 70, font);
  drawAtTop(page, section.kmOut, 181, top, 61, font);
  drawAtTop(page, section.kmIn, 285, top, 58, font);
  drawAtTop(page, section.departureTime, 385, top, 58, font);
  drawAtTop(page, section.arrivalTime, 490, top, 53, font);
}

function drawImpressions(page: PDFPage, section: RoadTestSection, firstTop: number, secondTop: number, font: PDFFont) {
  drawAtTop(page, section.impressions[0], 57, firstTop, 485, font, { size: 5.5, maxLines: 4, lineHeight: 6.4 });
  drawAtTop(page, section.impressions[1], 57, secondTop, 485, font, { size: 5.5, maxLines: 4, lineHeight: 6.4 });
}

export async function downloadRoadTestPdf(vehicle: VehicleFlow, form: RoadTestFormData) {
  const templateResponse = await fetch(templateUrl);
  if (!templateResponse.ok) throw new Error("Não foi possível carregar o modelo original da ficha.");

  const pdfDoc = await PDFDocument.load(await templateResponse.arrayBuffer());
  const page = pdfDoc.getPages()[0];
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Teste na recepção
  drawAtTop(page, form.serviceOrder, 108, 116, 84, bold, { size: 6.2 });
  drawAtTop(page, vehicle.plate?.startsWith("SEMPLACA") ? "" : vehicle.plate, 218, 116, 123, bold, { size: 6.2 });
  drawAtTop(page, form.reception.kmOut, 380, 116, 62, regular);
  drawAtTop(page, form.reception.departureTime, 482, 116, 61, regular);
  drawAtTop(page, form.reception.performedBy, 90, 142, 150, regular);
  drawAtTop(page, formatDate(form.reception.date), 270, 142, 72, regular);
  drawAtTop(page, form.reception.kmIn, 387, 142, 55, regular);
  drawAtTop(page, form.reception.arrivalTime, 491, 142, 52, regular);
  drawAtTop(page, form.clientRequests[0], 57, 168, 485, regular, { size: 5.5, maxLines: 2, lineHeight: 6.2 });
  drawAtTop(page, form.clientRequests[1], 57, 194, 485, regular, { size: 5.5, maxLines: 2, lineHeight: 6.2 });
  drawImpressions(page, form.reception, 233, 260, regular);
  drawAtTop(page, "X", form.reception.accompaniedByClient ? 141 : 171, 290, 8, bold, { size: 7 });

  // Teste interno para direcionamento ao técnico
  drawTripFields(page, form.internal, 337, regular);
  drawImpressions(page, form.internal, 356, 402, regular);
  drawAtTop(page, form.internal.performedBy, 90, 449, 452, regular);

  // Controle de qualidade
  drawTripFields(page, form.quality, 492, regular);
  drawImpressions(page, form.quality, 511, 557, regular);
  drawAtTop(page, form.quality.performedBy, 90, 604, 452, regular);

  // Teste de saída
  drawTripFields(page, form.delivery, 647, regular);
  drawImpressions(page, form.delivery, 666, 712, regular);
  drawAtTop(page, "X", form.delivery.accompaniedByClient ? 139 : 166, 765, 8, bold, { size: 7 });
  drawAtTop(page, form.delivery.performedBy, 440, 770, 103, regular);

  const receptionSignature = await embedSignature(pdfDoc, form.reception.clientSignatureDataUrl);
  const deliverySignature = await embedSignature(pdfDoc, form.delivery.clientSignatureDataUrl);
  drawSignatureAtTop(page, receptionSignature, 319, 285, 220, 21);
  drawSignatureAtTop(page, deliverySignature, 258, 759, 132, 20);

  const bytes = await pdfDoc.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const linkElement = document.createElement("a");
  const identity = (vehicle.plate || vehicle.clientName || "veiculo").replace(/[^a-zA-Z0-9_-]+/g, "-");
  linkElement.href = url;
  linkElement.download = `ficha-teste-rodagem-${identity}.pdf`;
  document.body.appendChild(linkElement);
  linkElement.click();
  linkElement.remove();
  URL.revokeObjectURL(url);
}
