// Quita las celdas vacías con formato (<c r="A1" s="3"/>) de las hojas enormes antes de leer el libro.
// Ciertos Excel pesan >100 MB de XML por esas celdas; sin ellas la lectura pasa de ~9 s a ~1 s y no se pierde ningún dato.
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const UMBRAL = 2e6;   // solo hojas de más de 2 MB de XML
export function limpiarLibro(buffer) {
  try {
    const z = unzipSync(new Uint8Array(buffer)), out = {};
    let tocado = false;
    for (const [n, d] of Object.entries(z)) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n) && d.length > UMBRAL) {
        out[n] = strToU8(strFromU8(d).replace(/<c [^>]*\/>/g, "")); tocado = true;
      } else out[n] = d;
    }
    return tocado ? zipSync(out, { level: 0 }) : new Uint8Array(buffer);
  } catch { return new Uint8Array(buffer); }   // si algo falla, se lee el archivo original
}
