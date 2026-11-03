// Worker: parsea el Excel fuera del hilo principal (hay libros de >100 MB de XML por celdas vacías).
import * as XLSX from "xlsx";
import { leerExcel } from "../docs/js/loader.js";
import { limpiarLibro } from "./limpiar.js";

self.onmessage = (e) => {
  const { id, buffer, nombre, empresa } = e.data;
  try {
    self.postMessage({ id, ok: true, ...leerExcel(XLSX, limpiarLibro(buffer), nombre, empresa) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
