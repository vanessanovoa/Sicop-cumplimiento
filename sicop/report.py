"""Reporte ejecutivo PDF (ReportLab)."""
from __future__ import annotations

import io
from datetime import date

import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)

from .rules import AL_DIA, COLORES, ESTADOS, PENDIENTE, POR_VENCER, UMBRAL_DEFECTO, VENCIDO

GRIS = colors.HexColor("#757171")
GRIS_CLARO = colors.HexColor("#F2F2F2")
_ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=_ss["Title"], textColor=GRIS, fontSize=26, leading=30, alignment=0)
H2 = ParagraphStyle("h2", parent=_ss["Heading2"], textColor=GRIS, fontSize=14, spaceBefore=6, spaceAfter=4)
H3 = ParagraphStyle("h3", parent=_ss["Heading3"], fontSize=11, spaceBefore=8, spaceAfter=3)
BODY = ParagraphStyle("body", parent=_ss["BodyText"], fontSize=9, leading=12)
CELL = ParagraphStyle("cell", parent=_ss["BodyText"], fontSize=7.5, leading=9)
CELLH = ParagraphStyle("cellh", parent=CELL, textColor=colors.white, fontName="Helvetica-Bold")


def _fmt_fecha(v) -> str:
    return v.strftime("%d/%m/%Y") if isinstance(v, date) else ""


def _tabla(datos, anchos, header_color=GRIS, extra=None):
    t = Table(datos, colWidths=anchos, repeatRows=1)
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), header_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, GRIS_CLARO]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BFBFBF")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    t.setStyle(TableStyle(estilo + (extra or [])))
    return t


def resumen_por_empresa(df: pd.DataFrame, por_categoria: bool = False) -> pd.DataFrame:
    claves = ["Empresa", "Categoría"] if por_categoria else ["Empresa"]
    base = df.groupby(claves).size().rename("Auditados").to_frame()
    for e in ESTADOS:
        base[e] = df[df["Estado"] == e].groupby(claves).size()
    base = base.fillna(0).astype(int).reset_index()
    base["% Cumplimiento"] = (base[AL_DIA] / base["Auditados"] * 100).round(1)
    return base


def _portada(df, corte, umbral, filtros):
    el = [Spacer(1, 25 * mm), Paragraph("Reporte Ejecutivo de Cumplimiento SICOP", H1),
          Paragraph(f"Fecha de corte: <b>{corte.strftime('%d/%m/%Y')}</b> &nbsp;·&nbsp; "
                    f"Por vencer: hasta {umbral} días", BODY)]
    if filtros:
        el.append(Paragraph(f"Filtros aplicados: {filtros}", BODY))
    el += [Spacer(1, 8 * mm), Paragraph("Resumen ejecutivo semanal", H2)]

    tot = len(df)
    kp = [[Paragraph(f"<b>{tot}</b><br/>Auditados", BODY)] + [
        Paragraph(f"<font color='{COLORES[e][0]}'><b>{(df['Estado'] == e).sum()}</b></font><br/>{e}", BODY)
        for e in ESTADOS]]
    kt = Table(kp, colWidths=[44 * mm] * 5)
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, GRIS), ("INNERGRID", (0, 0), (-1, -1), 0.25, GRIS),
                            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    el += [kt, Spacer(1, 6 * mm)]

    def tabla_res(res, cols):
        datos = [[Paragraph(c, CELLH) for c in cols]] + [[str(r[c]) if c != "% Cumplimiento" else f"{r[c]}%"
                                                         for c in cols] for _, r in res.iterrows()]
        extra = []
        for i, c in enumerate(cols):
            if c in COLORES:
                extra.append(("TEXTCOLOR", (i, 1), (i, -1), colors.HexColor(COLORES[c][0])))
                extra.append(("FONTNAME", (i, 1), (i, -1), "Helvetica-Bold"))
        ancho = 250 * mm / len(cols)
        return _tabla(datos, [ancho] * len(cols), extra=extra)

    el.append(Paragraph("Por empresa", H3))
    el.append(tabla_res(resumen_por_empresa(df), ["Empresa", "Auditados", *ESTADOS, "% Cumplimiento"]))
    el.append(Paragraph("Por empresa y categoría", H3))
    el.append(tabla_res(resumen_por_empresa(df, True), ["Empresa", "Categoría", "Auditados", *ESTADOS, "% Cumplimiento"]))
    return el


def _seccion(df, estado, titulo, nota):
    d = df[df["Estado"] == estado]
    color = colors.HexColor(COLORES[estado][0])
    el = [PageBreak(), Paragraph(f"{titulo} ({len(d)})", H2), Paragraph(nota, BODY)]
    if d.empty:
        return el + [Spacer(1, 4 * mm), Paragraph("Sin documentos en este estado.", BODY)]
    cols = ["Categoría", "Entidad", "Identificador", "Documento", "Vencimiento", "Días", "Detalle"]
    anchos = [24, 62, 28, 42, 24, 12, 58]
    anchos = [a * mm * 252 / sum(anchos) for a in anchos]
    d = d.sort_values(["Empresa", "Días", "Categoría", "Entidad"], na_position="first")
    for empresa, g in d.groupby("Empresa", sort=True):
        el.append(Paragraph(f"{empresa} — {len(g)} documento(s)", H3))
        filas = [[Paragraph(c, CELLH) for c in cols]]
        for _, r in g.iterrows():
            filas.append([Paragraph(str(x), CELL) for x in (
                r["Categoría"], r["Entidad"], r["Identificador"], r["Documento"],
                _fmt_fecha(r["Vencimiento"]) or "—", "—" if pd.isna(r["Días"]) else int(r["Días"]), r["Detalle"])])
        el.append(_tabla(filas, anchos, header_color=GRIS,
                         extra=[("LINEBEFORE", (0, 1), (0, -1), 3, color)]))
    return el


def generar_pdf(df: pd.DataFrame, corte: date, umbral: int = UMBRAL_DEFECTO, filtros: str = "") -> bytes:
    buf = io.BytesIO()

    def pie(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(GRIS)
        canvas.drawString(20 * mm, 10 * mm, f"SICOP · Corte {corte.strftime('%d/%m/%Y')}")
        canvas.drawRightString(landscape(A4)[0] - 20 * mm, 10 * mm, f"Página {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=15 * mm, bottomMargin=18 * mm, title="Reporte SICOP",
                            author="SICOP")
    el = _portada(df, corte, umbral, filtros)
    el += _seccion(df, VENCIDO, "Documentos vencidos (críticos)",
                   "Vencimiento hoy o anterior, o documentación faltante. Requieren regularización inmediata.")
    el += _seccion(df, POR_VENCER, f"Documentos por vencer (≤ {umbral} días)",
                   "Alerta preventiva: renovar antes del vencimiento.")
    el += _seccion(df, PENDIENTE, "Documentos pendientes de aprobación",
                   "Trámites presentados a la espera de aprobación; requieren seguimiento.")
    doc.build(el, onFirstPage=pie, onLaterPages=pie)
    return buf.getvalue()
