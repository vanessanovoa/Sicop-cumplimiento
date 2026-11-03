"""Ingesta de los Excel SICOP: detecta hojas/cabeceras y produce filas de documentos."""
from __future__ import annotations

import re
import unicodedata
from datetime import date
from pathlib import Path

import openpyxl
import pandas as pd

from .rules import UMBRAL_DEFECTO, es_pendiente, evaluar

EMPLEADOS, PROVEEDORES, VEHICULOS = "Empleados", "Proveedores", "Vehículos"
COLUMNAS = ["Empresa", "Categoría", "Subgrupo", "Entidad", "Identificador",
            "Documento", "Vencimiento", "Días", "Estado", "Detalle"]

# (nombre mostrado, encabezados normalizados aceptados, requerido)
DOCS_EMPLEADOS = [
    ("Apto médico", ("apto medico",), True),
    ("DNI", ("dni",), True),
    ("Licencia de conducir", ("licencia de conducir",), True),
    ("Capacitación", ("capacitacion",), True),
    ("Entrega EPP", ("entrega epp",), True),
    # Manual de seguridad, RA-4, Anexo V y Recibo de sueldo ya no son requeridos
    # (nota en la hoja 'sicop' del Excel), por lo que no se auditan.
]
DOCS_VEHICULOS = [
    ("VTV", ("vtv",), True),
    ("Póliza", ("poliza",), True),
    ("Cuota", ("cuota",), True),
    ("Formulario RA-15", ("formulario ra-15 eden", "formulario ra-15"), False),
]
_DOMINIO_RE = re.compile(r"^([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3})$")


def norm(texto) -> str:
    if texto is None:
        return ""
    t = unicodedata.normalize("NFKD", str(texto))
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t).strip().lower()


def nombre_empresa(nombre_archivo: str) -> str:
    stem = Path(nombre_archivo).stem
    return re.split(r"\s+F-?\d+\b", stem)[0].strip() or stem


def _txt(v) -> str:
    return "" if v is None else re.sub(r"\s+", " ", str(v)).strip()


def _cabeceras(ws) -> dict[str, int]:
    out: dict[str, int] = {}
    for c in next(ws.iter_rows(min_row=1, max_row=1, max_col=80)):
        if c.value is not None and norm(c.value) and norm(c.value) not in out:
            out[norm(c.value)] = c.column
    return out


def _col(cab, *alias):
    for a in alias:
        if a in cab:
            return cab[a]
    return None


def _hoja(wb, clave):
    for ws in wb.worksheets:
        if clave in norm(ws.title):
            return ws
    return None


class _Hoja:
    """Acceso a celdas por fila con límite de columnas (hay hojas que declaran >2000 columnas)."""

    def __init__(self, ws, max_col):
        self.filas = ws.iter_rows(min_row=2, max_col=max_col, values_only=True)
        self.max_col = max_col

    def __iter__(self):
        return enumerate(self.filas, start=2)


def _flag(fila, col, cab_cols):
    """Indicador de pendiente: celda inmediatamente a la izquierda del documento, si no tiene cabecera."""
    izq = col - 1
    if izq >= 1 and izq not in cab_cols and izq <= len(fila):
        return es_pendiente(fila[izq - 1])
    return False


def _items_documentos(fila, docs_cols, cab_cols, base):
    for nombre, col, req in docs_cols:
        yield {**base, "Documento": nombre, "valor": fila[col - 1] if col <= len(fila) else None,
               "flag": _flag(fila, col, cab_cols), "requerido": req}


def _resolver_docs(cab, docs):
    return [(n, _col(cab, *al), req) for n, al, req in docs if _col(cab, *al)]


def leer_excel(origen, nombre_archivo: str | None = None):
    """Lee un Excel. Devuelve (empresa, filas_crudas, avisos)."""
    nombre = nombre_archivo or Path(str(origen)).name
    empresa = nombre_empresa(nombre)
    avisos: list[str] = []
    wb = openpyxl.load_workbook(origen, data_only=False)
    filas: list[dict] = []

    # ---- Empleados
    ws = _hoja(wb, "empleado")
    if ws is None:
        avisos.append("No se encontró la hoja 'Empleados'.")
    else:
        cab = _cabeceras(ws)
        cab_cols = set(cab.values())
        docs = _resolver_docs(cab, DOCS_EMPLEADOS)
        c_ap, c_no, c_cu = _col(cab, "apellido"), _col(cab, "nombre"), _col(cab, "cuil")
        c_abm = _col(cab, "abm")
        if not (c_ap and docs):
            avisos.append("Empleados: faltan columnas clave (Apellido / documentos).")
        else:
            c_dis, c_suc = _col(cab, "distribuidora"), _col(cab, "sucursal")
            ult = max(cab.values())
            vistos: dict[str, int] = {}
            for n, f in _Hoja(ws, ult):
                ap = _txt(f[c_ap - 1])
                if not ap:
                    continue
                if c_abm and _txt(f[c_abm - 1]).lower() != "alta":
                    continue  # bajas no se auditan
                cuil = f[c_cu - 1] if c_cu else None
                cuil = str(int(cuil)) if isinstance(cuil, float) else _txt(cuil)
                if cuil and not re.fullmatch(r"\d{11}", cuil):
                    avisos.append(f"Empleados fila {n}: CUIL inválido ({cuil!r}).")
                if cuil:
                    if cuil in vistos:
                        avisos.append(f"Empleados fila {n}: CUIL duplicado con fila {vistos[cuil]}.")
                    vistos[cuil] = n
                base = {"Empresa": empresa, "Categoría": EMPLEADOS,
                        "Subgrupo": " / ".join(x for x in (_txt(f[c_dis - 1]) if c_dis else "",
                                                           _txt(f[c_suc - 1]) if c_suc else "") if x),
                        "Entidad": f"{ap} {_txt(f[c_no - 1]) if c_no else ''}".strip(),
                        "Identificador": cuil}
                filas.extend(_items_documentos(f, docs, cab_cols, base))

    # ---- Vehículos
    ws = _hoja(wb, "vehiculo")
    if ws is None:
        avisos.append("No se encontró la hoja 'Vehículos'.")
    else:
        cab = _cabeceras(ws)
        cab_cols = set(cab.values())
        docs = _resolver_docs(cab, DOCS_VEHICULOS)
        c_dom = _col(cab, "dominio")
        if not (c_dom and docs):
            avisos.append("Vehículos: faltan columnas clave (Dominio / documentos).")
        else:
            c_alta, c_ma, c_mo = _col(cab, "alta sicop"), _col(cab, "marca"), _col(cab, "modelo")
            c_lug = _col(cab, "lugar donde reside", "sucursal")
            ult = max(cab.values())
            vistos = {}
            for n, f in _Hoja(ws, ult):
                dom = _txt(f[c_dom - 1]).upper().replace(" ", "")
                if not dom:
                    continue
                if c_alta and _txt(f[c_alta - 1]).upper() == "NO":
                    continue
                if not _DOMINIO_RE.match(dom):
                    avisos.append(f"Vehículos fila {n}: dominio con formato inusual ({dom!r}).")
                if dom in vistos:
                    avisos.append(f"Vehículos fila {n}: dominio duplicado con fila {vistos[dom]}.")
                vistos[dom] = n
                base = {"Empresa": empresa, "Categoría": VEHICULOS,
                        "Subgrupo": _txt(f[c_lug - 1]) if c_lug else "",
                        "Entidad": f"{_txt(f[c_ma - 1]) if c_ma else ''} {_txt(f[c_mo - 1]) if c_mo else ''}".strip(),
                        "Identificador": dom}
                filas.extend(_items_documentos(f, docs, cab_cols, base))

    # ---- Proveedores (un documento por fila; una o más columnas de fecha entre 'Documentos' y 'Frecuencia')
    ws = _hoja(wb, "proveedor")
    if ws is None:
        avisos.append("No se encontró la hoja 'Proveedores'.")
    else:
        cab = _cabeceras(ws)
        cab_cols = set(cab.values())
        c_req, c_doc, c_frec = _col(cab, "requisito"), _col(cab, "documentos"), _col(cab, "frecuencia")
        if not (c_doc and c_frec and c_frec - c_doc > 1):
            avisos.append("Proveedores: no se detectaron columnas 'Documentos' / fecha / 'Frecuencia'.")
        else:
            fechas = [(nom, col) for nom, col in
                      ((h, c) for h, c in cab.items() if c_doc < c < c_frec)]
            cab_orig = {c: _txt(v.value) for c, v in
                        enumerate(next(ws.iter_rows(min_row=1, max_row=1, max_col=c_frec)), start=1)}
            for n, f in _Hoja(ws, c_frec):
                doc = _txt(f[c_doc - 1])
                if not doc:
                    continue
                base = {"Empresa": empresa, "Categoría": PROVEEDORES,
                        "Subgrupo": _txt(f[c_req - 1]) if c_req else "", "Entidad": doc, "Identificador": ""}
                dcols = [(f"Vencimiento {cab_orig[c]}", c, True) for _, c in fechas]
                filas.extend(_items_documentos(f, dcols, cab_cols, base))

    if not filas:
        avisos.append("No se extrajo ningún documento del archivo.")
    return empresa, filas, avisos


def construir_df(filas: list[dict], corte: date, umbral: int = UMBRAL_DEFECTO) -> pd.DataFrame:
    """Aplica el motor de reglas a las filas crudas."""
    out = []
    for r in filas:
        res = evaluar(r["valor"], r["flag"], r["requerido"], corte, umbral)
        if res is None:
            continue
        estado, venc, dias, detalle = res
        out.append({**{k: r[k] for k in COLUMNAS[:6]}, "Vencimiento": venc, "Días": dias,
                    "Estado": estado, "Detalle": detalle})
    df = pd.DataFrame(out, columns=COLUMNAS)
    df["Días"] = df["Días"].astype("Int64")
    return df
