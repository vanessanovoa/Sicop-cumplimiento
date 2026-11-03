"""Dashboard SICOP — ejecutar con:  streamlit run app.py"""
from datetime import date
from io import BytesIO

import pandas as pd
import streamlit as st

from sicop.loader import construir_df, leer_excel
from sicop.report import generar_pdf
from sicop.rules import AL_DIA, COLORES, ESTADOS, PENDIENTE, POR_VENCER, UMBRAL_DEFECTO, VENCIDO

st.set_page_config(page_title="SICOP · Cumplimiento", page_icon="📋", layout="wide")
st.markdown("""<style>
h1,h2,h3{color:#757171}
[data-testid="stMetric"]{border:1px solid #757171;border-radius:8px;padding:10px 14px;background:#fafafa}
</style>""", unsafe_allow_html=True)


@st.cache_data(show_spinner="Leyendo Excel…")
def cargar(nombre: str, contenido: bytes):
    return leer_excel(BytesIO(contenido), nombre)


st.title("📋 Consolidación y reportes SICOP")

with st.sidebar:
    st.header("1 · Carga")
    archivos = st.file_uploader("Excels SICOP (uno por empresa)", type=["xlsx", "xlsm"], accept_multiple_files=True)
    corte = st.date_input("Fecha de corte", value=date.today(), format="DD/MM/YYYY")
    umbral = st.number_input("Días para 'Por vencer'", 1, 90, UMBRAL_DEFECTO)

if not archivos:
    st.info("Cargá uno o más archivos Excel SICOP desde la barra lateral para comenzar.")
    st.stop()

frames, avisos_por_archivo = [], {}
for f in archivos:
    try:
        empresa, filas, avisos = cargar(f.name, f.getvalue())
    except Exception as exc:  # archivo corrupto / no es un Excel válido
        st.error(f"No se pudo leer **{f.name}**: {exc}")
        continue
    avisos_por_archivo[f.name] = avisos
    frames.append(construir_df(filas, corte, umbral))

if not frames:
    st.stop()
df = pd.concat(frames, ignore_index=True)

with st.sidebar:
    st.header("2 · Filtros")
    empresas = st.multiselect("Empresa / Cliente", sorted(df["Empresa"].unique()), default=sorted(df["Empresa"].unique()))
    estados = st.multiselect("Estado", ESTADOS, default=[VENCIDO, POR_VENCER, PENDIENTE])
    categorias = st.multiselect("Categoría", sorted(df["Categoría"].unique()), default=sorted(df["Categoría"].unique()))
    texto = st.text_input("Buscar (nombre, CUIL, dominio, documento)")

vista = df[df["Empresa"].isin(empresas) & df["Estado"].isin(estados) & df["Categoría"].isin(categorias)]
if texto:
    mask = vista[["Entidad", "Identificador", "Documento"]].astype(str).apply(
        lambda c: c.str.contains(texto, case=False, regex=False)).any(axis=1)
    vista = vista[mask]

# KPIs sobre el universo seleccionado en empresa/categoría (sin filtrar por estado)
base = df[df["Empresa"].isin(empresas) & df["Categoría"].isin(categorias)]
cols = st.columns(5)
cols[0].metric("Auditados", len(base))
for col, e, ico in zip(cols[1:], ESTADOS, ("🔴", "🟡", "🟠", "🟢")):
    col.metric(f"{ico} {e}", int((base["Estado"] == e).sum()))

st.subheader("Distribución")
pivot = base.pivot_table(index="Empresa", columns="Estado", values="Documento", aggfunc="count", fill_value=0)
orden = [e for e in ESTADOS if e in pivot.columns]
if orden:
    st.bar_chart(pivot[orden], color=[COLORES[e][0] for e in orden], horizontal=True)

st.subheader(f"Detalle ({len(vista)} registros)")


def _color(v):
    return f"color:{COLORES[v][0]};background-color:{COLORES[v][1]};font-weight:600" if v in COLORES else ""


st.dataframe(
    vista.sort_values(["Empresa", "Estado", "Días"], key=lambda s: s.map({e: i for i, e in enumerate(ESTADOS)})
                      if s.name == "Estado" else s).style.map(_color, subset=["Estado"]),
    width="stretch", hide_index=True,
    column_config={"Vencimiento": st.column_config.DateColumn(format="DD/MM/YYYY"),
                   "Días": st.column_config.NumberColumn(format="%d")})

st.subheader("Exportar PDF")
c1, c2 = st.columns(2)
filtros_txt = f"Empresa: {', '.join(empresas)} · Categoría: {', '.join(categorias)} · Estado: {', '.join(estados)}"
c1.download_button("⬇️ Reporte según filtros activos", data=generar_pdf(vista, corte, umbral, filtros_txt),
                   file_name=f"reporte_sicop_filtrado_{corte:%Y%m%d}.pdf", mime="application/pdf",
                   disabled=vista.empty, width="stretch")
c2.download_button("⬇️ Reporte completo (todas las empresas)", data=generar_pdf(df, corte, umbral),
                   file_name=f"reporte_sicop_completo_{corte:%Y%m%d}.pdf", mime="application/pdf",
                   width="stretch")

with st.expander("Validación de estructura de los archivos", expanded=any(avisos_por_archivo.values())):
    for nombre, av in avisos_por_archivo.items():
        if av:
            st.warning(f"**{nombre}** — {len(av)} aviso(s)")
            st.code("\n".join(av[:50]))
        else:
            st.success(f"{nombre}: estructura correcta")
