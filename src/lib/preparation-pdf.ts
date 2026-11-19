import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { separationParts, pickingIssues, sourceVersion, type Preparation } from "./preparation-planning";

export async function createPickingPdf(preparations: Preparation[]) {
  if (!preparations.length) throw new Error("Selecione ao menos um agendamento.");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.12, .18, .23), muted = rgb(.36, .40, .44);
  const border = rgb(.79, .82, .84), tint = rgb(.95, .96, .97);
  const clean = (value: string) => Array.from(value).map(c => {
    try { regular.encodeText(c); return c; } catch { return "?"; }
  }).join("");
  const wrap = (value: string, width: number, size: number, font: PDFFont = regular) => {
    const lines: string[] = [];
    for (const paragraph of clean(value).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) {
          lines.push(line); line = "";
        }
        for (const char of `${line ? " " : ""}${word}`) {
          if (font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ""; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  for (const p of preparations) {
    const issues = pickingIssues(p);
    if (issues.length || !p.parts.ready || p.parts.sourceVersion !== sourceVersion(p)) {
      throw new Error(`${p.appointment.client}: conclua e salve a conferência de peças antes do PDF. ${issues.join(" ")}`);
    }
    const a = p.appointment;
    const name = wrap(a.client, 523, 14, bold);
    const identityHeight = 25 + name.length * 16;
    const plate = wrap(p.parts.plate ?? a.plate, 145, 16, bold);
    const vin = wrap(p.parts.chassi ?? a.chassi, 346, 13, bold);
    const vehicleHeight = 25 + Math.max(plate.length * 18, vin.length * 15);
    const model = wrap(`${a.model} / ${p.parts.modelYear}`, 185, 10, bold);
    const service = wrap(`${a.service}${p.parts.revision ? ` · ${p.parts.revision}ª revisão (${p.parts.revision * 10000} km)` : ""}`, 306, 10);
    const serviceHeight = 25 + Math.max(model.length, service.length) * 12;
    const tableOffset = 29 + identityHeight + vehicleHeight + serviceHeight + 14;
    const capacity = 351 - tableOffset - 23;
    const blocks = separationParts(p).map(r => {
      const code = wrap(r.code, 107, 9, bold);
      const description = wrap(r.name, 333, 10, bold);
      const sources = wrap(r.source, 333, 7);
      const quantity = wrap(r.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 }), 43, 12, bold);
      return { code, description, sources, quantity, height: Math.max(code.length * 11, description.length * 12 + sources.length * 9 + 3, quantity.length * 14) + 12 };
    });
    const pages: typeof blocks[] = [];
    let current: typeof blocks = [], height = 0;
    for (const block of blocks) {
      if (block.height > capacity) throw new Error("Identificação ou descrição muito extensa para duas vias A4. Abrevie o texto e gere novamente.");
      if (height + block.height > capacity && current.length) { pages.push(current); current = []; height = 0; }
      current.push(block); height += block.height;
    }
    if (current.length) pages.push(current);
    for (let index = 0; index < pages.length; index++) {
      const page = pdf.addPage([595.28, 841.89]);
      page.drawLine({ start: { x: 24, y: 420.945 }, end: { x: 571, y: 420.945 }, thickness: .5, color: border, dashArray: [4, 4] });
      for (const top of [819, 398.055]) {
        const text = (value: string, x: number, offset: number, size = 10, strong = false, color = ink) => {
          page.drawText(clean(value), { x, y: top - offset - size, size, font: strong ? bold : regular, color });
        };
        const lines = (values: string[], x: number, offset: number, size: number, leading: number, strong = false, color = ink) => {
          values.forEach((value, i) => text(value, x, offset + i * leading, size, strong, color));
        };
        const line = (x1: number, x2: number, offset: number) => page.drawLine({ start: { x: x1, y: top - offset }, end: { x: x2, y: top - offset }, thickness: .5, color: border });
        const vertical = (x: number, offset: number, height: number) => page.drawLine({ start: { x, y: top - offset }, end: { x, y: top - offset - height }, thickness: .5, color: border });
        const box = (offset: number, height: number, filled = false) => {
          const w = 547, r = 7;
          page.drawSvgPath(`M ${r} 0 H ${w-r} Q ${w} 0 ${w} ${r} V ${height-r} Q ${w} ${height} ${w-r} ${height} H ${r} Q 0 ${height} 0 ${height-r} V ${r} Q 0 0 ${r} 0 Z`, {
            x: 24, y: top - offset, color: filled ? tint : rgb(1, 1, 1), borderColor: border, borderWidth: .6,
          });
        };
        const date = `AGENDAMENTO: ${p.date.split("-").reverse().join("/")}  ${a.time}`;
        text(date, (595.28 - bold.widthOfTextAtSize(clean(date), 11)) / 2, 0, 11, true);
        let offset = 29;
        box(offset, identityHeight, true);
        text("CLIENTE", 35, offset + 7, 7, true, muted);
        lines(name, 35, offset + 20, 14, 16, true);
        offset += identityHeight;
        text("PLACA", 35, offset + 7, 7, true, muted);
        text("CHASSI", 203, offset + 7, 7, true, muted);
        lines(plate, 35, offset + 19, 16, 18, true);
        lines(vin, 203, offset + 21, 13, 15, true);
        offset += vehicleHeight;
        box(offset, serviceHeight);
        text("MODELO / ANO", 35, offset + 7, 7, true, muted);
        text("SERVIÇO / REVISÃO", 253, offset + 7, 7, true, muted);
        lines(model, 35, offset + 20, 10, 12, true);
        lines(service, 253, offset + 20, 10, 12);
        vertical(241, offset + 8, serviceHeight - 16);
        const tableHeight = 23 + pages[index].reduce((sum, row) => sum + row.height, 0);
        box(tableOffset, tableHeight);
        text("REFERÊNCIA", 35, tableOffset + 7, 8, true, muted);
        text("PEÇAS A SEPARAR", 154, tableOffset + 7, 8, true, muted);
        text("QTD.", 519, tableOffset + 7, 8, true, muted);
        vertical(143, tableOffset, tableHeight);
        vertical(507, tableOffset, tableHeight);
        let rowOffset = tableOffset + 23;
        for (const row of pages[index]) {
          line(24, 571, rowOffset);
          lines(row.code, 35, rowOffset + 6, 9, 11, true);
          lines(row.description, 154, rowOffset + 6, 10, 12, true);
          lines(row.sources, 154, rowOffset + 9 + row.description.length * 12, 7, 9, false, muted);
          lines(row.quantity, 519, rowOffset + 6, 12, 14, true);
          rowOffset += row.height;
        }
        text("Via: Estoque", 24, 360, 11, true);
        text(`SEPARAÇÃO DE PEÇAS · ${index + 1}/${pages.length}`, 405, 363, 7, false, muted);
        text("SEPARADO POR: _____________________", 24, 383, 8, false, muted);
        text("CONFERIDO POR: _____________________", 327, 383, 8, false, muted);
      }
    }
  }
  return pdf.save();
}
