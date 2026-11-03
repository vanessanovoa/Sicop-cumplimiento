// Motor de reglas: clasifica un documento según su fecha de vencimiento.
export const VENCIDO = "Vencido";
export const POR_VENCER = "Por vencer";
export const PENDIENTE = "Pendiente de aprobación";
export const AL_DIA = "Al día";
export const ESTADOS = [VENCIDO, POR_VENCER, PENDIENTE, AL_DIA];
export const UMBRAL_DEFECTO = 15;
export const COLORES = {
  [VENCIDO]: ["#DC2626", "#FEE2E2"],
  [POR_VENCER]: ["#B45309", "#FEF3C7"],
  [PENDIENTE]: ["#6D28D9", "#EDE9FE"],
  [AL_DIA]: ["#15803D", "#DCFCE7"],
};

const DIA_MS = 86400000;
const NA = new Set(["na", "n/a", "n.a.", "no aplica", "-", "--"]);
const FALTANTE = new Set(["faltante", "no"]);

export const hoyUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
export const fmtFecha = (d) => d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}` : "";

export function esPendiente(v) {
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return /^1(?!\d)/.test(v.trim());
  return false;
}

function fechaValida(y, m, d) {
  if (y < 1990 || y > 2100) return null;
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? f : null;
}

export function parsearFecha(v) {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return null;
  const t = v.trim();
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) { // d/m/Y y, si no es válida, m/d/Y
    return fechaValida(+m[3], +m[2], +m[1]) || fechaValida(+m[3], +m[1], +m[2]);
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? fechaValida(+m[1], +m[2], +m[3]) : null;
}

export function clasificarDias(dias, umbral = UMBRAL_DEFECTO) {
  if (dias <= 0) return VENCIDO;
  return dias <= umbral ? POR_VENCER : AL_DIA;
}

/** Devuelve {estado, vencimiento, dias, detalle} o null si el documento no aplica. */
export function evaluar(valor, flag, requerido, corte, umbral = UMBRAL_DEFECTO) {
  const vacio = valor === null || valor === undefined || (typeof valor === "string" && !valor.trim());
  const fecha = vacio ? null : parsearFecha(valor);
  const dias = fecha ? Math.round((fecha - corte) / DIA_MS) : null;

  if (flag || (typeof valor === "string" && esPendiente(valor) && !fecha))
    return { estado: PENDIENTE, vencimiento: fecha, dias, detalle: "Presentado, pendiente de aprobación" };
  if (vacio) return requerido ? { estado: VENCIDO, vencimiento: null, dias: null, detalle: "Sin fecha cargada (faltante)" } : null;
  if (fecha) {
    const estado = clasificarDias(dias, umbral);
    const detalle = estado === VENCIDO ? (dias === 0 ? "Vence hoy" : `Vencido hace ${-dias} días`)
      : estado === POR_VENCER ? `Vence en ${dias} días` : "";
    return { estado, vencimiento: fecha, dias, detalle };
  }
  if (typeof valor === "string") {
    const t = valor.trim().toLowerCase();
    if (NA.has(t)) return null;
    if (FALTANTE.has(t)) return { estado: VENCIDO, vencimiento: null, dias: null, detalle: "Faltante" };
  }
  return { estado: VENCIDO, vencimiento: null, dias: null, detalle: `Dato inválido: '${String(valor).trim()}'` };
}
