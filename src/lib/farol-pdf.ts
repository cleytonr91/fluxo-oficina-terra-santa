import { PDFDocument } from "pdf-lib";

type FarolPdfReport = {
  key: string;
  label: string;
  element: HTMLElement | null;
};

type FarolPdfInput = {
  monthLabel: string;
  reports: FarolPdfReport[];
};

const A4_LANDSCAPE = { width: 841.89, height: 595.28, margin: 12 };
const STAGE_WIDTH = 1400;
const RENDER_SCALE = 2;
const COMBINED_REPORT_KEYS = new Set(["counter", "revenue", "gross-profit"]);

function sanitizeClone(element: HTMLElement) {
  element.querySelectorAll<HTMLElement>("[data-pdf-hide='true'], [data-html2canvas-ignore='true']").forEach((item) => item.remove());
  element.querySelectorAll<HTMLElement>("[id]").forEach((item) => item.removeAttribute("id"));
  return element;
}

function cloneReport(element: HTMLElement) {
  return sanitizeClone(element.cloneNode(true) as HTMLElement);
}

function consultantReportUnits(element: HTMLElement) {
  const cards = Array.from(element.querySelectorAll<HTMLElement>(".farol-consultant-report-card"));
  if (!cards.length) return [cloneReport(element)];

  return cards.map((card) => {
    const shell = element.cloneNode(false) as HTMLElement;
    const heading = element.querySelector<HTMLElement>(":scope > .panel-head");
    if (heading) shell.appendChild(heading.cloneNode(true));

    const report = document.createElement("div");
    report.className = "farol-consultant-report";
    const grid = document.createElement("div");
    grid.className = "farol-consultant-report-grid";
    grid.appendChild(card.cloneNode(true));
    report.appendChild(grid);
    shell.appendChild(report);
    return sanitizeClone(shell);
  });
}

function combinedReportUnit(reports: Array<FarolPdfReport & { element: HTMLElement }>) {
  const wrapper = document.createElement("div");
  wrapper.className = "farol-pdf-combined-reports";
  reports.forEach((report) => wrapper.appendChild(cloneReport(report.element)));
  return wrapper;
}

async function nextPaint() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function downloadFarolPdf({ monthLabel, reports }: FarolPdfInput) {
  const availableReports = reports.filter((report): report is FarolPdfReport & { element: HTMLElement } => Boolean(report.element));
  if (!availableReports.length) throw new Error("Selecione ao menos um relatório disponível para gerar o PDF.");

  await document.fonts.ready;
  const { default: html2canvas } = await import("html2canvas");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Farol Gerencial - ${monthLabel}`);
  pdf.setSubject("Relatórios gerenciais selecionados no Farol");
  pdf.setCreator("Farol Gerencial");

  const stage = document.createElement("div");
  stage.className = "farol-pdf-stage";
  stage.setAttribute("aria-hidden", "true");
  document.body.appendChild(stage);

  try {
    const combinedReports = availableReports.filter((report) => COMBINED_REPORT_KEYS.has(report.key));
    let combinedReportsAdded = false;

    for (const report of availableReports) {
      if (COMBINED_REPORT_KEYS.has(report.key)) {
        if (combinedReportsAdded) continue;
        combinedReportsAdded = true;
      }
      const units = COMBINED_REPORT_KEYS.has(report.key)
        ? [combinedReportUnit(combinedReports)]
        : report.key === "consultants"
          ? consultantReportUnits(report.element)
          : [cloneReport(report.element)];

      for (const unit of units) {
        stage.replaceChildren(unit);
        await nextPaint();

        const canvas = await html2canvas(unit, {
          backgroundColor: "#f4f7f5",
          scale: RENDER_SCALE,
          useCORS: true,
          logging: false,
          width: STAGE_WIDTH - 24,
          windowWidth: STAGE_WIDTH,
          windowHeight: Math.max(unit.scrollHeight, document.documentElement.clientHeight),
        });

        const contentWidth = A4_LANDSCAPE.width - A4_LANDSCAPE.margin * 2;
        const contentHeight = A4_LANDSCAPE.height - A4_LANDSCAPE.margin * 2;
        const renderScale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height);
        const renderedWidth = canvas.width * renderScale;
        const renderedHeight = canvas.height * renderScale;
        const page = pdf.addPage([A4_LANDSCAPE.width, A4_LANDSCAPE.height]);
        const image = await pdf.embedPng(canvas.toDataURL("image/png"));

        page.drawImage(image, {
          x: (A4_LANDSCAPE.width - renderedWidth) / 2,
          y: A4_LANDSCAPE.height - A4_LANDSCAPE.margin - renderedHeight,
          width: renderedWidth,
          height: renderedHeight,
        });
      }
    }
  } finally {
    stage.remove();
  }

  const bytes = await pdf.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `farol-gerencial-${monthLabel.toLowerCase().replace(/\s+/g, "-")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
