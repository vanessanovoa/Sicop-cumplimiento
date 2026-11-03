// Modelo de datos del cliente: entidades con documentos, y su conversión a filas del motor de reglas y desde el Excel.
import { esPendiente, parsearFecha } from "./rules.js";
import { norm } from "./loader.js";

export const TIPOS = {
  empleado:  { categoria: "Empleados",   singular: "Empleado",  plural: "Empleados",   idEtiqueta: "CUIL",    nombreEtiqueta: "Apellido y nombre", grupoEtiqueta: "Distribuidora / Sucursal" },
  vehiculo:  { categoria: "Vehículos",   singular: "Vehículo",  plural: "Vehículos",   idEtiqueta: "Dominio", nombreEtiqueta: "Marca y modelo",    grupoEtiqueta: "Lugar de residencia" },
  proveedor: { categoria: "Proveedores", singular: "Requisito", plural: "Proveedores", idEtiqueta: "",        nombreEtiqueta: "Documento",         grupoEtiqueta: "Requisito" },
};
export const TIPO_DE_CATEGORIA = Object.fromEntries(Object.entries(TIPOS).map(([t, v]) => [v.categoria, t]));
const NA = new Set(["na", "n/a", "n.a.", "no aplica", "-", "--"]);

const isoAFecha = (iso) => iso ? new Date(`${iso}T00:00:00Z`) : null;
const fechaAIso = (d) => d.toISOString().slice(0, 10);

/** Identificador estable de una entidad. Los empleados sin CUIL usan "~nombre". */
export function claveEntidad(tipo, id, etiqueta, subgrupo) {
  if (tipo === "proveedor") return `${subgrupo}|${etiqueta}`;
  return id || `~${norm(etiqueta)}`;
}
const idVisible = (e) => e.tipo === "proveedor" || String(e.identificador).startsWith("~") ? "" : e.identificador;

/** entidades -> filas del motor de reglas (mismo formato que produce loader.leerExcel). */
export function entidadesAFilas(entidades, nombreOrg) {
  const filas = [];
  for (const e of entidades) {
    if (e.archivada_en) continue;
    const base = { empresa: nombreOrg(e.org_id), categoria: TIPOS[e.tipo].categoria, subgrupo: e.subgrupo || "", entidad: e.etiqueta, id: idVisible(e) };
    for (const d of e.documentos || [])
      filas.push({ ...base, documento: d.nombre, valor: d.no_aplica ? "NA" : isoAFecha(d.vencimiento), flag: !!d.presentado, requerido: !!d.requerido });
  }
  return filas;
}

/** Filas del Excel -> entidades listas para importar. Devuelve {entidades, avisos}. */
export function filasAEntidades(filas) {
  const mapa = new Map(), avisos = [];
  for (const f of filas) {
    const tipo = TIPO_DE_CATEGORIA[f.categoria];
    if (!tipo) continue;
    const identificador = claveEntidad(tipo, f.id, f.entidad, f.subgrupo);
    const k = `${tipo}|${identificador}`;
    let e = mapa.get(k);
    if (!e) {
      e = { tipo, etiqueta: f.entidad, identificador, subgrupo: f.subgrupo || "", datos: {}, documentos: [] };
      mapa.set(k, e);
    } else if (e.documentos.some((d) => d.nombre === f.documento)) {
      avisos.push(`${TIPOS[tipo].singular} repetido en el archivo (${f.entidad}): se usa la última fila.`);
    }
    e.documentos = e.documentos.filter((d) => d.nombre !== f.documento);
    const v = f.valor, doc = { nombre: f.documento, requerido: !!f.requerido, vencimiento: null, presentado: !!f.flag, no_aplica: false };
    if (v instanceof Date) doc.vencimiento = fechaAIso(v);
    else if (typeof v === "string") {
      const fecha = parsearFecha(v);
      if (fecha) doc.vencimiento = fechaAIso(fecha);
      else if (NA.has(v.trim().toLowerCase())) doc.no_aplica = true;
      else if (esPendiente(v)) doc.presentado = true;
    }
    e.documentos.push(doc);
  }
  return { entidades: [...mapa.values()], avisos: [...new Set(avisos)] };
}

/**
 * Vista previa de importar `nuevas` sobre `existentes` (entidades de UNA organización, activas y archivadas).
 * Solo se pisan los tipos presentes en el archivo. `ultima` = ISO de la última importación de esa organización (o null).
 */
export function diffImportacion(nuevas, existentes, ultima) {
  const tipos = [...new Set(nuevas.map((e) => e.tipo))];
  const porClave = new Map(existentes.map((e) => [`${e.tipo}|${e.identificador}`, e]));
  const vistas = new Set();
  const r = { tipos, nuevas: 0, actualizadas: 0, restauradas: 0, archivadas: 0, ediciones: [], total: nuevas.length };
  const editada = (e) => !ultima || new Date(e.actualizada_en) > new Date(ultima);
  for (const n of nuevas) {
    const k = `${n.tipo}|${n.identificador}`, e = porClave.get(k);
    vistas.add(k);
    if (!e) r.nuevas++;
    else if (e.archivada_en) r.restauradas++;
    else { r.actualizadas++; if (editada(e)) r.ediciones.push(e.etiqueta); }
  }
  for (const e of existentes) {
    if (e.archivada_en || !tipos.includes(e.tipo) || vistas.has(`${e.tipo}|${e.identificador}`)) continue;
    r.archivadas++;
    if (editada(e)) r.ediciones.push(e.etiqueta);
  }
  return r;
}

/** Peor estado de una lista de registros evaluados (orden de ESTADOS: Vencido es el peor). */
export const peorEstado = (regs, orden) => regs.reduce((p, r) => (p == null || orden.indexOf(r.estado) < orden.indexOf(p) ? r.estado : p), null);
