"""Uso: python -m sicop.cli archivo1.xlsx [archivo2.xlsx ...] -o reporte.pdf [--corte AAAA-MM-DD]"""
import argparse
from datetime import date

import pandas as pd

from .loader import construir_df, leer_excel
from .report import generar_pdf
from .rules import UMBRAL_DEFECTO


def main():
    p = argparse.ArgumentParser()
    p.add_argument("archivos", nargs="+")
    p.add_argument("-o", "--salida", default="reporte_sicop.pdf")
    p.add_argument("--corte", type=date.fromisoformat, default=date.today())
    p.add_argument("--umbral", type=int, default=UMBRAL_DEFECTO)
    a = p.parse_args()
    dfs = []
    for f in a.archivos:
        empresa, filas, avisos = leer_excel(f)
        for v in avisos:
            print(f"[{empresa}] AVISO: {v}")
        dfs.append(construir_df(filas, a.corte, a.umbral))
    df = pd.concat(dfs, ignore_index=True)
    print(df.groupby(["Empresa", "Categoría", "Estado"]).size().to_string())
    with open(a.salida, "wb") as fh:
        fh.write(generar_pdf(df, a.corte, a.umbral))
    print("PDF:", a.salida)


if __name__ == "__main__":
    main()
