import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import XLSX from "xlsx";
import { evaluar, VENCIDO, POR_VENCER, PENDIENTE, AL_DIA } from "../docs/js/rules.js";
import { leerExcel, construirRegistros, nombreEmpresa } from "../docs/js/loader.js";

const HOY = new Date(Date.UTC(2026, 10, 2));
const est = (v, f = false, r = true) => evaluar(v, f, r, HOY)?.estado ?? null;

test("límites de reglas", () => {
  assert.equal(est(new Date(Date.UTC(2026, 10, 2))), VENCIDO);
  assert.equal(est(new Date(Date.UTC(2026, 10, 3))), POR_VENCER);
  assert.equal(est(new Date(Date.UTC(2026, 10, 17))), POR_VENCER);
  assert.equal(est(new Date(Date.UTC(2026, 10, 18))), AL_DIA);
  assert.equal(est(new Date(Date.UTC(2050, 0, 1)), true), PENDIENTE);
  assert.equal(est("1 - presentado"), PENDIENTE);
  assert.equal(est("11/1272039"), VENCIDO);
  assert.equal(est("NA"), null);
  assert.equal(est(null, false, false), null);
  assert.equal(est(null), VENCIDO);
  assert.equal(est("FALTANTE"), VENCIDO);
  assert.equal(est("16/6/2026"), VENCIDO);
});

test("nombre de empresa", () => {
  assert.equal(nombreEmpresa("CMAS F-1 Objetivos del Cliente SICOP(Documentación).xlsx"), "CMAS");
});

const MUESTRA = process.env.SICOP_MUESTRA;
test("archivo de muestra coincide con la versión Python", { skip: !MUESTRA }, () => {
  const { empresa, filas, avisos } = leerExcel(XLSX, fs.readFileSync(MUESTRA), "CMAS F-1 Objetivos.xlsx");
  const reg = construirRegistros(filas, HOY);
  const cuenta = {};
  reg.forEach((r) => { const k = `${r.categoria}|${r.estado}`; cuenta[k] = (cuenta[k] || 0) + 1; });
  assert.equal(empresa, "CMAS");
  assert.deepEqual(avisos, []);
  assert.deepEqual(cuenta, {
    "Empleados|Al día": 223, "Empleados|Pendiente de aprobación": 12, "Empleados|Vencido": 25,
    "Proveedores|Al día": 14, "Proveedores|Por vencer": 3, "Proveedores|Vencido": 6,
    "Vehículos|Al día": 67, "Vehículos|Por vencer": 1, "Vehículos|Vencido": 7 });
});

test("limpiarLibro: mismo resultado que el archivo original y mucho más rápido", { skip: !MUESTRA }, async () => {
  const { limpiarLibro } = await import("../src/limpiar.js");
  const buf = fs.readFileSync(MUESTRA);
  const t = Date.now(), limpio = limpiarLibro(buf), ms = Date.now() - t;
  const a = leerExcel(XLSX, limpio, "CMAS F-1.xlsx"), b = leerExcel(XLSX, buf, "CMAS F-1.xlsx");
  assert.deepEqual(a.filas, b.filas);
  assert.deepEqual(a.avisos, b.avisos);
  assert.ok(limpio.length < buf.length / 2, "el libro limpio pesa mucho menos");
  assert.ok(ms < 8000, `limpieza lenta: ${ms} ms`);
  assert.deepEqual(limpiarLibro(new Uint8Array([1, 2, 3]).buffer), new Uint8Array([1, 2, 3]), "un archivo inválido se devuelve tal cual");
});
