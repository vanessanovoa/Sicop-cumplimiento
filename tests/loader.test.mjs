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
  assert.equal(nombreEmpresa("Empresa A F-1 Objetivos del Cliente SICOP(Documentación).xlsx"), "Empresa A");
  assert.equal(nombreEmpresa("Empresa A F-1 Objetivos del Cliente SICOP(Documentación) (1).xlsx"), "Empresa A");
  assert.equal(nombreEmpresa("_F-1 Objetivos del Cliente SICOP(Documentación).xlsx"), "", "sin empresa en el nombre");
  assert.equal(nombreEmpresa("SICOP EMPRESA DEMO S.A.xlsx"), "SICOP EMPRESA DEMO S.A");
});

// Libro mínimo en memoria con las tres hojas (aoa = filas; las fechas como número de serie con formato).
const sinHojas = (avisos) => avisos.filter((a) => !a.startsWith("No se encontró la hoja"));
function libro({ emp, veh, prov }) {
  const wb = XLSX.utils.book_new();
  const hoja = (aoa, fechas = []) => { const ws = XLSX.utils.aoa_to_sheet(aoa); fechas.forEach(([ref, v]) => { ws[ref] = { t: "n", v, z: "d/m/yyyy" }; }); return ws; };
  if (emp) XLSX.utils.book_append_sheet(wb, hoja(...emp), "Empleados");
  if (veh) XLSX.utils.book_append_sheet(wb, hoja(...veh), "Vehículos");
  if (prov) XLSX.utils.book_append_sheet(wb, hoja(...prov), "Proveedores");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

test("una celda de fecha ilegible (#####) no impide leer el archivo y se avisa", () => {
  const buf = libro({ emp: [[
    ["Apellido", "Nombre", "ABM", "Cuil", null, "Apto Médico", null, "DNI"],
    ["APELLIDO UNO", "NOMBRE", "Alta", "20111111112", null, null, null, null],
    ["APELLIDO DOS", "NOMBRE", "Alta", "27333333339", null, null, null, null],
  ], [["F2", 9999999], ["H2", 47000], ["F3", 47000], ["H3", 47000]]] });
  const { filas, avisos } = leerExcel(XLSX, buf, "X F-1.xlsx");
  assert.equal(filas.length, 4);
  const apto = filas.find((f) => f.entidad === "APELLIDO UNO NOMBRE" && f.documento === "Apto médico");
  assert.match(String(apto.valor), /ilegible/);
  assert.equal(evaluar(apto.valor, false, true, HOY).estado, VENCIDO);
  assert.deepEqual(sinHojas(avisos), ["Empleados fila 2 (APELLIDO UNO NOMBRE): 'Apto médico' con dato inválido ('fecha ilegible (9999999)'); se carga sin fecha."]);
});

test("documentos opcionales de monotributistas: vacío no se audita, con fecha sí", () => {
  const buf = libro({ emp: [[
    ["Apellido", "Nombre", "ABM", "Cuil", null, "DNI", null, "Seg accidentes Personales", null, "Pago monotributo"],
    ["APELLIDO UNO", "NOMBRE", "Alta", "20111111112", null, "1/1/2030", null, "1/1/2030", null, null],
  ]] });
  const { filas } = leerExcel(XLSX, buf, "X F-1.xlsx");
  const reg = construirRegistros(filas, HOY);
  assert.deepEqual(reg.map((r) => `${r.documento}|${r.estado}`).sort(),
    ["DNI|Al día", "Seguro de accidentes personales|Al día"]);
});

test("fechas mal tipeadas generan aviso (se cargan sin fecha)", () => {
  const buf = libro({ veh: [[
    ["Marca", "Modelo", "Dominio", "Alta Sicop", null, "VTV", null, "Cuota"],
    ["MARCA", "MODELO", "AB123CD", "SI", null, "1/1/2027", null, "3111/2'26"],
  ]] });
  const { avisos } = leerExcel(XLSX, buf, "X F-1.xlsx");
  assert.deepEqual(sinHojas(avisos), ["Vehículos fila 2 (AB123CD): 'Cuota' con dato inválido ('3111/2'26'); se carga sin fecha."]);
});

test("Proveedores: columna de grupo con otro nombre; secciones de subcontratistas no se importan", () => {
  const prov = (cabGrupo) => libro({ prov: [[
    [cabGrupo, "Documentos", null, null, "DESA", "FRECUENCIA"],
    ["FORMULARIOS", "FORMULARIO GENERAL", null, null, "8/11/2026", "mensual"],
    ["EDIFICIO", "ATS EDIFICIO", null, null, "16/10/2026", "semestral"],
    ["PERSONA UNO", null, null, null, null, null],
    ["FORMULARIOS", "FORMULARIO GENERAL", null, null, "6/11/2026", "mensual"],
    ["EDIFICIO", "ATS EDIFICIO", null, null, "16/4/2027", "semestral"],
    ["PERSONA DOS", null, null, null, null, null],
    ["FORMULARIOS", "FORMULARIO GENERAL", null, null, "7/11/2026", "mensual"],
  ]] });
  for (const cabGrupo of ["Requisito", "Requisitos", "CARPETA SICOP"]) {
    const { filas, avisos } = leerExcel(XLSX, prov(cabGrupo), "X F-1.xlsx");
    assert.deepEqual(sinHojas(avisos), [
      "Proveedores: 2 documento(s) del subcontratista 'PERSONA UNO' no se importan (se cargan a mano).",
      "Proveedores: 1 documento(s) del subcontratista 'PERSONA DOS' no se importan (se cargan a mano)."], cabGrupo);
    assert.deepEqual(filas.map((f) => `${f.subgrupo}|${f.entidad}|${f.valor}`),
      ["FORMULARIOS|FORMULARIO GENERAL|8/11/2026", "EDIFICIO|ATS EDIFICIO|16/10/2026"], cabGrupo);
  }
});

const MUESTRA = process.env.SICOP_MUESTRA;
test("archivo de muestra coincide con la versión Python", { skip: !MUESTRA }, () => {
  const { empresa, filas, avisos } = leerExcel(XLSX, fs.readFileSync(MUESTRA), "Empresa A F-1 Objetivos.xlsx");
  const reg = construirRegistros(filas, HOY);
  const cuenta = {};
  reg.forEach((r) => { const k = `${r.categoria}|${r.estado}`; cuenta[k] = (cuenta[k] || 0) + 1; });
  assert.equal(empresa, "Empresa A");
  assert.deepEqual(avisos.filter((a) => !/dato inválido/.test(a)), []);
  assert.deepEqual(cuenta, {
    "Empleados|Al día": 223, "Empleados|Pendiente de aprobación": 12, "Empleados|Vencido": 25,
    "Proveedores|Al día": 14, "Proveedores|Por vencer": 3, "Proveedores|Vencido": 6,
    "Vehículos|Al día": 67, "Vehículos|Por vencer": 1, "Vehículos|Vencido": 7 });
});

test("limpiarLibro: mismo resultado que el archivo original y mucho más rápido", { skip: !MUESTRA }, async () => {
  const { limpiarLibro } = await import("../src/limpiar.js");
  const buf = fs.readFileSync(MUESTRA);
  const t = Date.now(), limpio = limpiarLibro(buf), ms = Date.now() - t;
  const a = leerExcel(XLSX, limpio, "Empresa A F-1.xlsx"), b = leerExcel(XLSX, buf, "Empresa A F-1.xlsx");
  assert.deepEqual(a.filas, b.filas);
  assert.deepEqual(a.avisos, b.avisos);
  assert.ok(limpio.length < buf.length / 2, "el libro limpio pesa mucho menos");
  assert.ok(ms < 8000, `limpieza lenta: ${ms} ms`);
  assert.deepEqual(limpiarLibro(new Uint8Array([1, 2, 3]).buffer), new Uint8Array([1, 2, 3]), "un archivo inválido se devuelve tal cual");
});
