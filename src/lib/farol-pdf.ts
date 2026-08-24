import { PDFDocument } from "pdf-lib";

type FarolPdfInput = {
  monthLabel: string;
  element: HTMLElement | null;
};

const A4_LANDSCAPE = { width: 841.89, height: 595.28, margin: 18 };

export async function downloadFarolPdf({ monthLabel, element }: FarolPdfInput) {
  if (!element) throw new Error("Não foi possível preparar a visualização do Farol para exportação.");

  await document.fonts.ready;
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(element, {
    backgroundColor: "#f4f7f5",
    scale: 1,
    useCORS: true,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const pdf = await PDFDocument.create();
  const contentWidth = A4_LANDSCAPE.width - A4_LANDSCAPE.margin * 2;
  const contentHeight = A4_LANDSCAPE.height - A4_LANDSCAPE.margin * 2;
  const scale = contentWidth / canvas.width;
  const pageSliceHeight = Math.max(1, Math.floor(contentHeight / scale));

  for (let sourceY = 0; sourceY < canvas.height; sourceY += pageSliceHeight) {
    const sliceHeight = Math.min(pageSliceHeight, canvas.height - sourceY);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const context = slice.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem do Farol para exportação.");

    context.fillStyle = "#f4f7f5";
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

    const page = pdf.addPage([A4_LANDSCAPE.width, A4_LANDSCAPE.height]);
    const image = await pdf.embedJpg(slice.toDataURL("image/jpeg", 0.9));
    const renderedHeight = sliceHeight * scale;
    page.drawImage(image, {
      x: A4_LANDSCAPE.margin,
      y: A4_LANDSCAPE.height - A4_LANDSCAPE.margin - renderedHeight,
      width: contentWidth,
      height: renderedHeight,
    });
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
  URL.revokeObjectURL(url);
}
