import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import XLSX from "xlsx";
import { leerExcel, construirRegistros } from "../docs/js/loader.js";
import { entidadesAFilas, filasAEntidades, diffImportacion, claveEntidad } from "../docs/js/modelo.js";
import { cuilValido, dominioValido, normalizarDominio, errorClave } from "../docs/js/validadores.js";
import { puede, ACCIONES } from "../docs/js/permisos.js";

const HOY = new Date(Date.UTC(2026, 10, 2));
const MUESTRA = process.env.SICOP_MUESTRA;

const cuenta = (reg) => { const c = {}; reg.forEach((r) => { const k = `${r.categoria}|${r.estado}`; c[k] = (c[k] || 0) + 1; }); return c; };

test("paridad: Excel -> entidades -> filas da los mismos registros", { skip: !MUESTRA }, () => {
  const { filas } = leerExcel(XLSX, fs.readFileSync(MUESTRA), "CMAS F-1 Objetivos.xlsx");
  const original = construirRegistros(filas, HOY);
  const { entidades, avisos } = filasAEntidades(filas);
  assert.deepEqual(avisos, [], "el Excel de muestra no debe generar avisos");
  const ents = entidades.map((e, i) => ({ ...e, id: String(i), org_id: "o", archivada_en: null }));
  const vuelta = construirRegistros(entidadesAFilas(ents, () => "CMAS"), HOY);
  assert.equal(vuelta.length, original.length);
  assert.deepEqual(cuenta(vuelta), cuenta(original));
  const total = (e) => Object.values(e).reduce((a, b) => a + b, 0);
  assert.equal(total(cuenta(vuelta)), 358);
  // mismos documentos con el mismo estado y fecha
  const k = (r) => `${r.categoria}|${r.id}|${r.entidad}|${r.documento}|${r.estado}|${r.vencimiento?.toISOString() ?? ""}`;
  assert.deepEqual(vuelta.map(k).sort(), original.map(k).sort());
});

test("conversión de una celda a documento", () => {
  const f = (valor, flag = false, requerido = true) => ({ empresa: "E", categoria: "Empleados", subgrupo: "", entidad: "Ana", id: "20111111112", documento: "DNI", valor, flag, requerido });
  const d = (valor, flag, req) => filasAEntidades([f(valor, flag, req)]).entidades[0].documentos[0];
  assert.deepEqual(d(new Date(Date.UTC(2027, 0, 5))), { nombre: "DNI", requerido: true, vencimiento: "2027-01-05", presentado: false, no_aplica: false });
  assert.equal(d("NA").no_aplica, true);
  assert.equal(d("16/6/2026").vencimiento, "2026-06-16");
  assert.equal(d(null).vencimiento, null);
  assert.equal(d("FALTANTE").vencimiento, null);
  assert.equal(d(new Date(Date.UTC(2050, 0, 1)), true).presentado, true);
  assert.equal(d("1 - presentado").presentado, true);
});

test("claves de entidad y repetidos", () => {
  assert.equal(claveEntidad("empleado", "20111111112", "Ana", ""), "20111111112");
  assert.equal(claveEntidad("empleado", "", "Ana Pérez", ""), "~ana perez");
  assert.equal(claveEntidad("proveedor", "", "Seguro", "ART"), "ART|Seguro");
  const fila = (doc) => ({ empresa: "E", categoria: "Empleados", subgrupo: "", entidad: "Ana", id: "1", documento: doc, valor: null, flag: false, requerido: true });
  const r = filasAEntidades([fila("DNI"), fila("DNI"), fila("Apto médico")]);
  assert.equal(r.entidades.length, 1);
  assert.equal(r.entidades[0].documentos.length, 2);
  assert.equal(r.avisos.length, 1);
  assert.equal(filasAEntidades([fila("DNI"), fila("Apto médico")]).avisos.length, 0, "documentos distintos no son repetidos");
  // las filas sin id no se muestran con la clave interna
  const e = { tipo: "empleado", identificador: "~ana", etiqueta: "Ana", org_id: "o", documentos: [{ nombre: "DNI", requerido: true, vencimiento: null }] };
  assert.equal(entidadesAFilas([e], () => "E")[0].id, "");
});

test("entidadesAFilas ignora archivadas", () => {
  const e = { tipo: "vehiculo", identificador: "AB123CD", etiqueta: "Fiat", org_id: "o", archivada_en: "2026-01-01", documentos: [{ nombre: "VTV", requerido: true, vencimiento: null }] };
  assert.equal(entidadesAFilas([e], () => "E").length, 0);
});

test("diffImportacion: nuevas, actualizadas, restauradas, archivadas y ediciones manuales", () => {
  const ex = (tipo, id, extra = {}) => ({ tipo, identificador: id, etiqueta: `E-${id}`, archivada_en: null, actualizada_en: "2026-10-01T00:00:00Z", ...extra });
  const existentes = [ex("empleado", "1"), ex("empleado", "2"), ex("empleado", "3", { archivada_en: "2026-09-01" }),
    ex("empleado", "4", { actualizada_en: "2026-10-30T00:00:00Z" }), ex("vehiculo", "V1")];
  const nuevas = ["1", "3", "5"].map((id) => ({ tipo: "empleado", identificador: id }));
  const r = diffImportacion(nuevas, existentes, "2026-10-26T00:00:00Z");
  assert.deepEqual([r.nuevas, r.actualizadas, r.restauradas, r.archivadas], [1, 1, 1, 2]);
  assert.deepEqual(r.ediciones, ["E-4"]);       // el 4 se archiva y fue editado a mano después de la última carga
  assert.deepEqual(r.tipos, ["empleado"]);      // el vehículo no se toca porque el archivo no trae vehículos
  assert.equal(diffImportacion(nuevas, existentes, null).ediciones.length, 3); // sin importación previa: todo es manual
});

test("CUIL con dígito verificador y dominios", () => {
  assert.equal(cuilValido("20111111112"), true);
  assert.equal(cuilValido("20111111113"), false);
  assert.equal(cuilValido("2011111111"), false);
  assert.equal(cuilValido("abcdefghijk"), false);
  assert.equal(cuilValido("27-12345678-3".replace(/-/g, "")), false);
  assert.equal(dominioValido("ab 123 cd"), true);
  assert.equal(normalizarDominio("ab-123 cd"), "AB123CD");
  assert.equal(dominioValido("ABC123"), true);
  assert.equal(dominioValido("A1"), false);
  assert.ok(errorClave("corta")); assert.equal(errorClave("una-clave-larga"), "");
});

test("matriz de permisos por rol", () => {
  const esperado = {
    admin: ACCIONES,
    trabajador: ["ver", "pdf", "editarEntidad", "agregarEntidad"],
    revisor: ["ver", "pdf"],
  };
  for (const [rol, lista] of Object.entries(esperado))
    for (const a of ACCIONES) assert.equal(puede(rol, a), lista.includes(a), `${rol}:${a}`);
  assert.equal(puede("hacker", "ver"), false);
  assert.equal(puede(undefined, "ver"), false);
});
