// Reporte ejecutivo PDF (jsPDF + autoTable).
import { ESTADOS, VENCIDO, POR_VENCER, PENDIENTE, AL_DIA, COLORES, fmtFecha } from "./rules.js";

const GRIS = [31, 95, 168], CLARO = [238, 243, 250]; // azul corporativo
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const M = 15; // margen

export function resumen(reg, porCategoria = false) {
  const g = new Map();
  for (const r of reg) {
    const k = porCategoria ? `${r.empresa}\u0000${r.categoria}` : r.empresa;
    if (!g.has(k)) g.set(k, { empresa: r.empresa, categoria: r.categoria, total: 0, ...Object.fromEntries(ESTADOS.map((e) => [e, 0])) });
    const x = g.get(k); x.total++; x[r.estado]++;
  }
  return [...g.values()].sort((a, b) => a.empresa.localeCompare(b.empresa) || (a.categoria || "").localeCompare(b.categoria || ""))
    .map((x) => ({ ...x, pct: x.total ? Math.round(x[AL_DIA] / x.total * 1000) / 10 : 0 }));
}

function tablaResumen(doc, filas, conCategoria, y) {
  const head = ["Empresa", ...(conCategoria ? ["Categoría"] : []), "Auditados", ...ESTADOS, "% Cumplimiento"];
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, head: [head],
    body: filas.map((r) => [r.empresa, ...(conCategoria ? [r.categoria] : []), r.total, ...ESTADOS.map((e) => r[e]), `${r.pct}%`]),
    styles: { fontSize: 9 }, headStyles: { fillColor: GRIS, textColor: 255 }, alternateRowStyles: { fillColor: CLARO },
    didParseCell: (d) => {
      const e = ESTADOS[d.column.index - (conCategoria ? 3 : 2)];
      if (d.section === "body" && e) { d.cell.styles.textColor = hex(COLORES[e][0]); d.cell.styles.fontStyle = "bold"; }
    },
  });
  return doc.lastAutoTable.finalY;
}

function portada(doc, reg, corte, umbral, filtros) {
  doc.setTextColor(...GRIS).setFont("helvetica", "bold").setFontSize(24);
  doc.text("Reporte Ejecutivo de Cumplimiento SICOP", M, 38);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(60);
  doc.text(`Fecha de corte: ${fmtFecha(corte)}   |   Por vencer: hasta ${umbral} días`, M, 47);
  let y = 53;
  if (filtros) { const l = doc.splitTextToSize(`Filtros aplicados: ${filtros}`, 267); doc.text(l, M, y); y += l.length * 5; }
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...GRIS).text("Resumen ejecutivo semanal", M, y + 8);
  y += 14;
  const w = 267 / 5, kp = [["Auditados", reg.length, [15, 61, 117]], ...ESTADOS.map((e) => [e, reg.filter((r) => r.estado === e).length, hex(COLORES[e][0])])];
  kp.forEach(([lab, n, c], i) => {
    const x = M + i * w;
    doc.setDrawColor(...GRIS).rect(x, y, w, 22);
    doc.setTextColor(...c).setFont("helvetica", "bold").setFontSize(20).text(String(n), x + 4, y + 11);
    doc.setTextColor(60).setFont("helvetica", "normal").setFontSize(9).text(lab, x + 4, y + 18);
  });
  y += 30;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(0).text("Por empresa", M, y);
  y = tablaResumen(doc, resumen(reg), false, y + 3) + 9;
  if (y > 150) { doc.addPage(); y = 20; }
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(0).text("Por empresa y categoría", M, y);
  tablaResumen(doc, resumen(reg, true), true, y + 3);
}

function seccion(doc, reg, estado, titulo, nota) {
  const d = reg.filter((r) => r.estado === estado);
  doc.addPage();
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...GRIS).text(`${titulo} (${d.length})`, M, 22);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60).text(nota, M, 29);
  let y = 36;
  if (!d.length) { doc.text("Sin documentos en este estado.", M, y); return; }
  d.sort((a, b) => a.empresa.localeCompare(b.empresa) || (a.dias ?? -1e9) - (b.dias ?? -1e9) ||
    a.categoria.localeCompare(b.categoria) || a.entidad.localeCompare(b.entidad));
  const color = hex(COLORES[estado][0]);
  for (const emp of [...new Set(d.map((r) => r.empresa))]) {
    const g = d.filter((r) => r.empresa === emp);
    if (y > 175) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(0).text(`${emp} - ${g.length} documento(s)`, M, y);
    doc.autoTable({
      startY: y + 3, margin: { left: M, right: M, top: 18 }, styles: { fontSize: 8, cellPadding: 1.6 },
      head: [["Categoría", "Entidad", "Identificador", "Documento", "Vencimiento", "Días", "Detalle"]],
      body: g.map((r) => [r.categoria, r.entidad, r.id, r.documento, fmtFecha(r.vencimiento) || "-", r.dias ?? "-", r.detalle]),
      headStyles: { fillColor: GRIS, textColor: 255 }, alternateRowStyles: { fillColor: CLARO },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 62 }, 2: { cellWidth: 28 }, 3: { cellWidth: 40 }, 4: { cellWidth: 24 }, 5: { cellWidth: 12 } },
      didDrawCell: (c) => { if (c.section === "body" && c.column.index === 0) { doc.setFillColor(...color); doc.rect(c.cell.x, c.cell.y, 1.2, c.cell.height, "F"); } },
    });
    y = doc.lastAutoTable.finalY + 9;
  }
}

/** Devuelve un Blob PDF. jsPDF debe traer el plugin autoTable. */
export function generarPdf(jsPDF, reg, corte, umbral, filtros = "") {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setProperties({ title: "Reporte SICOP" });
  portada(doc, reg, corte, umbral, filtros);
  seccion(doc, reg, VENCIDO, "Documentos vencidos (críticos)", "Vencimiento hoy o anterior, o documentación faltante. Requieren regularización inmediata.");
  seccion(doc, reg, POR_VENCER, `Documentos por vencer (hasta ${umbral} días)`, "Alerta preventiva: renovar antes del vencimiento.");
  seccion(doc, reg, PENDIENTE, "Documentos pendientes de aprobación", "Trámites presentados a la espera de aprobación; requieren seguimiento.");
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i).setFont("helvetica", "normal").setFontSize(8).setTextColor(...GRIS);
    doc.text(`SICOP - Corte ${fmtFecha(corte)}`, M, 203);
    doc.text(`Página ${i} de ${n}`, 297 - M, 203, { align: "right" });
  }
  return doc.output("blob");
}
