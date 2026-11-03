// Validaciones de datos ingresados a mano.
import { DOMINIO_RE } from "./loader.js";

/** CUIL/CUIT de 11 dígitos con dígito verificador (módulo 11). */
export function cuilValido(c) {
  const t = String(c ?? "").trim();
  if (!/^\d{11}$/.test(t)) return false;
  const d = [...t].map(Number), pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((a, p, i) => a + p * d[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return t.startsWith("23") && (d[10] === 4 || d[10] === 9); // caso especial de la AFIP
  return dv === d[10];
}
export const normalizarDominio = (t) => String(t ?? "").toUpperCase().replace(/[\s-]/g, "");
export const dominioValido = (t) => DOMINIO_RE.test(normalizarDominio(t));

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CLAVE_MIN = 10;
export function errorClave(c) {
  if (typeof c !== "string" || c.length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
  return "";
}
/** Contraseña inicial legible (sin caracteres ambiguos). */
export function generarClave(largo = 14) {
  const set = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint32Array(largo));
  return Array.from(b, (x) => set[x % set.length]).join("");
}
