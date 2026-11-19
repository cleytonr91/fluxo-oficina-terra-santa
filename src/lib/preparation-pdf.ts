import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { separationParts, pickingIssues, sourceVersion, type Preparation } from "./preparation-planning";

export async function createPickingPdf(preparations: Preparation[]) {
  if(!preparations.length)throw new Error("Selecione ao menos um agendamento.");
  const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean=(text:string)=>Array.from(text).map(c=>{try{regular.encodeText(c);return c;}catch{return "?";}}).join("");
  const wrap=(text:string,width:number,size:number)=>{const lines:string[]=[];let line="";for(const char of clean(text)){if(char==='\n'){lines.push(line);line="";continue;}if(regular.widthOfTextAtSize(line+char,size)>width){lines.push(line);line="";}line+=char;}if(line)lines.push(line);return lines;};
  for(const p of preparations) {
    const issues=pickingIssues(p);if(issues.length || !p.parts.ready || p.parts.sourceVersion!==sourceVersion(p))throw new Error(`${p.appointment.client}: conclua e salve a conferência de peças antes do PDF. ${issues.join(" ")}`);
    const rows=separationParts(p), a=p.appointment;
    // Split only when necessary; every continuation repeats the two identical copies, without truncation.
    const blocks=rows.map(r=>({r,lines:wrap(`${r.code} — ${r.name}`,440,10),sources:wrap(r.source,440,8)}));
    const pages:typeof blocks[]=[];let current:typeof blocks=[],height=0;
    for(const block of blocks){const h=Math.max(22,block.lines.length*15+block.sources.length*13+3);if(h>175)throw new Error("Descrição de peça muito longa para a ficha. Abrevie a descrição e gere novamente.");if(height+h>175&&current.length){pages.push(current);current=[];height=0;}current.push(block);height+=h;}if(current.length)pages.push(current);
    for(let index=0;index<pages.length;index++) {
      const page=pdf.addPage([595.28,841.89]);
      page.drawLine({start:{x:22,y:420.94},end:{x:573,y:420.94},thickness:.5,color:rgb(.6,.6,.6),dashArray:[4,3]});
      for(const top of [819,398]) {
        let y=top;
        const text=(value:string,size=10,strong=false)=>{page.drawText(clean(value),{x:26,y,size,font:strong?bold:regular});y-=size+5;};
        text(`SEPARAÇÃO DE PEÇAS · ${index+1}/${pages.length}`,10,true);
        text(`AGENDAMENTO: ${p.date.split('-').reverse().join('/')} ${a.time}   APOLO: ${p.parts.apoloCode}`,10);
        for(const line of wrap(a.client,540,14))text(line,14,true);
        text(`PLACA: ${p.parts.plate ?? a.plate}`,16,true);
        for(const line of wrap(`${a.model} / ${p.parts.modelYear}   CHASSI: ${p.parts.chassi ?? a.chassi}`,540,10))text(line,10);
        for(const line of wrap(`SERVIÇO: ${a.service}${p.parts.revision?` · ${p.parts.revision}ª revisão (${p.parts.revision*10000} km)`:''}`,540,10))text(line,10);
        text("PEÇAS / QUANTIDADES",10,true);
        for(const block of pages[index]) {
          if(y<top-350)throw new Error("Cabeçalho muito extenso para duas vias A4. Reduza o texto do serviço ou identificação.");
          page.drawText(block.r.quantity.toLocaleString('pt-BR',{maximumFractionDigits:3}),{x:520,y,size:12,font:bold});
          for(const line of block.lines)text(line,10,true);
          for(const line of block.sources)text(line,8);
          y-=3;
        }
        if(y<top-375)throw new Error("Lista excede a área da via. Reduza a descrição das peças.");
        page.drawText("SEPARADO POR: _____________________  CONFERIDO POR: _____________________",{x:26,y:top-381,size:8,font:regular});
      }
    }
  }
  return pdf.save();
}
