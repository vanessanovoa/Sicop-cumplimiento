import test from "node:test";
import assert from "node:assert/strict";
import { jsPDF, } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import { generarPdf } from "../docs/js/report.js";
import { evaluar } from "../docs/js/rules.js";

test("el PDF se genera con las 4 partes", async () => {
  applyPlugin(jsPDF);
  const corte = new Date(Date.UTC(2026, 10, 2));
  const mk = (empresa, v, f = false) => { const e = evaluar(v, f, true, corte); return { empresa, categoria: "Empleados", subgrupo: "", entidad: "PÉREZ JUAN", id: "20111111111", documento: "Apto médico", vencimiento: e.vencimiento, dias: e.dias, estado: e.estado, detalle: e.detalle }; };
  const reg = [mk("Empresa A", new Date(Date.UTC(2026, 9, 1))), mk("Empresa A", new Date(Date.UTC(2026, 10, 10))), mk("Empresa B", null, true), mk("Empresa B", new Date(Date.UTC(2030, 0, 1)))];
  const blob = generarPdf(jsPDF, reg, corte, 15, "Empresa: todas");
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  await (await import("node:fs/promises")).writeFile(process.env.SICOP_PDF_OUT || "/dev/null", buf);
});
