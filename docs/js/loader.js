// Ingesta de los Excel SICOP: detecta hojas/cabeceras y produce filas de documentos.
import { evaluar, esPendiente, UMBRAL_DEFECTO } from "./rules.js";

export const EMPLEADOS = "Empleados", PROVEEDORES = "Proveedores", VEHICULOS = "Vehículos";

// [nombre mostrado, encabezados normalizados aceptados, requerido]
// Manual de seguridad, RA-4, Anexo V y Recibo de sueldo ya no son requeridos
// (nota en la hoja 'sicop' del Excel), por lo que no se auditan.
const DOCS_EMPLEADOS = [
  ["Apto médico", ["apto medico"], true], ["DNI", ["dni"], true],
  ["Licencia de conducir", ["licencia de conducir"], true],
  ["Capacitación", ["capacitacion"], true], ["Entrega EPP", ["entrega epp"], true],
  // Opcionales (solo monotributistas): vacío = no se audita.
  ["Seguro de accidentes personales", ["seg accidentes personales", "seguro de accidentes personales", "seg. accidentes personales"], false],
  ["Pago monotributo", ["pago monotributo", "monotributo"], false],
];
const DOCS_VEHICULOS = [
  ["VTV", ["vtv"], true], ["Póliza", ["poliza"], true], ["Cuota", ["cuota"], true],
  ["Formulario RA-15", ["formulario ra-15 eden", "formulario ra-15"], false],
];
export const DOMINIO_RE = /^([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3})$/;

export const norm = (t) => t == null ? "" :
  String(t).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const txt = (v) => v == null ? "" : String(v).replace(/\s+/g, " ").trim();

/** Nombre sugerido de la organización: texto previo a "F-1" (sin " (1)" de descargas repetidas). "" si no hay. */
export function nombreEmpresa(archivo) {
  const stem = archivo.replace(/\.[^.]+$/, "").replace(/\s*\(\d+\)$/, "").trim();
  if (/^[\s_-]*F-?\d+\b/i.test(stem)) return ""; // p. ej. "_F-1 Objetivos…": el archivo no dice la empresa
  return stem.split(/\s+F-?\d+\b/)[0].trim() || stem;
}

function celda(XLSX, c) {
  if (!c) return null;
  if (c.t === "n") {
    if (c.z && XLSX.SSF.is_date(c.z)) {
      // Un número fuera del rango de fechas de Excel (se ve como ##### en Excel) no debe impedir leer el archivo.
      const p = XLSX.SSF.parse_date_code(c.v);
      return p && p.y ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : `fecha ilegible (${c.v})`;
    }
    return c.v;
  }
  if (c.t === "s") return c.v;
  if (c.t === "d") return new Date(Date.UTC(c.v.getFullYear(), c.v.getMonth(), c.v.getDate()));
  return null;
}

/** Hoja -> {cab: {nombreNormalizado: col(1-based)}, cabOrig, filas: [[...]]} acotada a las columnas con cabecera. */
function leerHoja(XLSX, ws) {
  const rango = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const cab = {}, cabOrig = {};
  const maxC = Math.min(rango.e.c, 80);
  let ult = 0;
  for (let c = 0; c <= maxC; c++) {
    const v = celda(XLSX, ws[XLSX.utils.encode_cell({ r: 0, c })]);
    const n = norm(v);
    if (n) { if (!(n in cab)) cab[n] = c + 1; cabOrig[c + 1] = txt(v); ult = c + 1; }
  }
  const filas = [];
  for (let r = 1; r <= rango.e.r; r++) {
    const fila = [];
    for (let c = 0; c < ult; c++) fila.push(celda(XLSX, ws[XLSX.utils.encode_cell({ r, c })]));
    filas.push(fila);
  }
  return { cab, cabOrig, cols: new Set(Object.values(cab)), filas, ult };
}

const col = (cab, ...alias) => { for (const a of alias) if (a in cab) return cab[a]; return null; };
const resolverDocs = (cab, docs) => docs.map(([n, al, req]) => [n, col(cab, ...al), req]).filter((d) => d[1]);
const hojaPorClave = (wb, clave) => wb.SheetNames.find((n) => norm(n).includes(clave));
// Indicador de pendiente: celda inmediatamente a la izquierda del documento, si no tiene cabecera.
const flag = (f, c, cols) => c - 1 >= 1 && !cols.has(c - 1) && c - 1 <= f.length && esPendiente(f[c - 2]);
const items = (f, docs, cols, base) => docs.map(([nombre, c, req]) =>
  ({ ...base, documento: nombre, valor: c <= f.length ? f[c - 1] : null, flag: flag(f, c, cols), requerido: req }));
const CORTE_FIJO = new Date(Date.UTC(2000, 0, 1)); // solo para detectar datos inválidos (no depende de la fecha)
/** Avisa los valores que no son fecha, NA, FALTANTE ni pendiente: al importar se guardan vacíos. */
function avisarInvalidos(its, donde, avisos) {
  for (const it of its) {
    const e = evaluar(it.valor, it.flag, it.requerido, CORTE_FIJO);
    if (e?.detalle?.startsWith("Dato inválido"))
      avisos.push(`${donde}: '${it.documento}' con dato inválido ('${String(it.valor).trim()}'); se carga sin fecha.`);
  }
  return its;
}

/** Lee un libro Excel (ArrayBuffer). Devuelve {empresa, filas, avisos}. */
export function leerExcel(XLSX, buffer, nombreArchivo, empresaForzada) {
  const empresa = empresaForzada || nombreEmpresa(nombreArchivo);
  const avisos = [], filas = [];
  const wb = XLSX.read(buffer, { type: "array", cellNF: true, cellDates: false });
  const hoja = (clave, etiqueta) => {
    const n = hojaPorClave(wb, clave);
    if (!n) { avisos.push(`No se encontró la hoja '${etiqueta}'.`); return null; }
    return leerHoja(XLSX, wb.Sheets[n]);
  };

  let h = hoja("empleado", EMPLEADOS);
  if (h) {
    const { cab, cols } = h, docs = resolverDocs(cab, DOCS_EMPLEADOS);
    const cAp = col(cab, "apellido"), cNo = col(cab, "nombre"), cCu = col(cab, "cuil"), cAbm = col(cab, "abm");
    if (!(cAp && docs.length)) avisos.push("Empleados: faltan columnas clave (Apellido / documentos).");
    else {
      const cDis = col(cab, "distribuidora"), cSuc = col(cab, "sucursal"), vistos = {};
      h.filas.forEach((f, i) => {
        const n = i + 2, ap = txt(f[cAp - 1]);
        if (!ap) return;
        if (cAbm && txt(f[cAbm - 1]).toLowerCase() !== "alta") return; // bajas no se auditan
        let cuil = cCu ? f[cCu - 1] : null;
        cuil = typeof cuil === "number" ? String(Math.trunc(cuil)) : txt(cuil);
        if (cuil && !/^\d{11}$/.test(cuil)) avisos.push(`Empleados fila ${n}: CUIL inválido ('${cuil}').`);
        if (cuil) { if (vistos[cuil]) avisos.push(`Empleados fila ${n}: CUIL duplicado con fila ${vistos[cuil]}.`); vistos[cuil] = n; }
        const base = { empresa, categoria: EMPLEADOS,
          subgrupo: [cDis ? txt(f[cDis - 1]) : "", cSuc ? txt(f[cSuc - 1]) : ""].filter(Boolean).join(" / "),
          entidad: `${ap} ${cNo ? txt(f[cNo - 1]) : ""}`.trim(), id: cuil };
        filas.push(...avisarInvalidos(items(f, docs, cols, base), `Empleados fila ${n} (${base.entidad})`, avisos));
      });
    }
  }

  h = hoja("vehiculo", VEHICULOS);
  if (h) {
    const { cab, cols } = h, docs = resolverDocs(cab, DOCS_VEHICULOS), cDom = col(cab, "dominio");
    if (!(cDom && docs.length)) avisos.push("Vehículos: faltan columnas clave (Dominio / documentos).");
    else {
      const cAlta = col(cab, "alta sicop"), cMa = col(cab, "marca"), cMo = col(cab, "modelo");
      const cLug = col(cab, "lugar donde reside", "sucursal"), vistos = {};
      h.filas.forEach((f, i) => {
        const n = i + 2, dom = txt(f[cDom - 1]).toUpperCase().replace(/ /g, "");
        if (!dom) return;
        if (cAlta && txt(f[cAlta - 1]).toUpperCase() === "NO") return;
        if (!DOMINIO_RE.test(dom)) avisos.push(`Vehículos fila ${n}: dominio con formato inusual ('${dom}').`);
        if (vistos[dom]) avisos.push(`Vehículos fila ${n}: dominio duplicado con fila ${vistos[dom]}.`);
        vistos[dom] = n;
        const base = { empresa, categoria: VEHICULOS, subgrupo: cLug ? txt(f[cLug - 1]) : "",
          entidad: `${cMa ? txt(f[cMa - 1]) : ""} ${cMo ? txt(f[cMo - 1]) : ""}`.trim(), id: dom };
        filas.push(...avisarInvalidos(items(f, docs, cols, base), `Vehículos fila ${n} (${dom})`, avisos));
      });
    }
  }

  // Proveedores: un documento por fila; una o más columnas de fecha entre 'Documentos' y 'Frecuencia'.
  // La columna de grupo se llama distinto según el archivo ("Requisito", "Requisitos", "Carpeta SICOP"…);
  // si no se reconoce, se usa la primera columna. Una fila con texto solo en esa columna (el nombre de un
  // subcontratista) abre una sección: esos documentos se gestionan a mano y no se importan (se avisa).
  h = hoja("proveedor", PROVEEDORES);
  if (h) {
    const { cab, cabOrig, cols } = h, cDoc = col(cab, "documentos"), cFrec = col(cab, "frecuencia");
    let cReq = col(cab, "requisito", "requisitos", "carpeta sicop", "carpeta");
    if (!cReq && cDoc > 1) cReq = 1;
    if (!(cDoc && cFrec && cFrec - cDoc > 1)) avisos.push("Proveedores: no se detectaron columnas 'Documentos' / fecha / 'Frecuencia'.");
    else {
      const fechas = Object.values(cab).filter((c) => c > cDoc && c < cFrec);
      let seccion = "";
      const subcontratistas = new Map();
      h.filas.forEach((f, i) => {
        const doc = txt(f[cDoc - 1]), grupo = cReq ? txt(f[cReq - 1]) : "";
        if (!doc) {
          const vacia = f.every((v, j) => j === cReq - 1 || v == null || (typeof v === "string" && !v.trim()));
          if (grupo && vacia) seccion = grupo;
          return;
        }
        if (seccion) { subcontratistas.set(seccion, (subcontratistas.get(seccion) || 0) + 1); return; }
        const base = { empresa, categoria: PROVEEDORES, subgrupo: grupo, entidad: doc, id: "" };
        filas.push(...avisarInvalidos(items(f, fechas.map((c) => [`Vencimiento ${cabOrig[c]}`, c, true]), cols, base), `Proveedores fila ${i + 2} (${doc})`, avisos));
      });
      for (const [persona, n] of subcontratistas)
        avisos.push(`Proveedores: ${n} documento(s) del subcontratista '${persona}' no se importan (se cargan a mano).`);
    }
  }
  if (!filas.length) avisos.push("No se extrajo ningún documento del archivo.");
  return { empresa, filas, avisos };
}

/** Aplica el motor de reglas a las filas crudas. */
export function construirRegistros(filas, corte, umbral = UMBRAL_DEFECTO) {
  const out = [];
  for (const r of filas) {
    const e = evaluar(r.valor, r.flag, r.requerido, corte, umbral);
    if (!e) continue;
    out.push({ empresa: r.empresa, categoria: r.categoria, subgrupo: r.subgrupo, entidad: r.entidad, id: r.id,
      documento: r.documento, vencimiento: e.vencimiento, dias: e.dias, estado: e.estado, detalle: e.detalle });
  }
  return out;
}
