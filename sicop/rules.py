"""Motor de reglas: clasifica un documento según su fecha de vencimiento."""
from __future__ import annotations

import re
from datetime import date, datetime

VENCIDO = "Vencido"
POR_VENCER = "Por vencer"
PENDIENTE = "Pendiente de aprobación"
AL_DIA = "Al día"
ESTADOS = [VENCIDO, POR_VENCER, PENDIENTE, AL_DIA]

UMBRAL_DEFECTO = 15

# Colores de alerta (texto, fondo suave)
COLORES = {
    VENCIDO: ("#C00000", "#F8D7DA"),
    POR_VENCER: ("#7F6000", "#FFF2CC"),
    PENDIENTE: ("#C55A11", "#FCE4D6"),
    AL_DIA: ("#375623", "#E2EFDA"),
}

_NA = {"na", "n/a", "n.a.", "no aplica", "-", "--"}
_FALTANTE = {"faltante", "no"}
_PENDIENTE_RE = re.compile(r"^1(?!\d)")
_FORMATOS = ("%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y")


def es_pendiente(valor) -> bool:
    """True si el valor es el indicador de pendiente de aprobación (1, '1', '1 - presentado')."""
    if isinstance(valor, bool):
        return False
    if isinstance(valor, (int, float)):
        return valor == 1
    if isinstance(valor, str):
        return bool(_PENDIENTE_RE.match(valor.strip()))
    return False


def parsear_fecha(valor) -> date | None:
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str):
        texto = valor.strip()
        for fmt in _FORMATOS:
            try:
                d = datetime.strptime(texto, fmt).date()
            except ValueError:
                continue
            if 1990 <= d.year <= 2100:
                return d
    return None


def clasificar_dias(dias: int, umbral: int = UMBRAL_DEFECTO) -> str:
    if dias <= 0:
        return VENCIDO
    if dias <= umbral:
        return POR_VENCER
    return AL_DIA


def evaluar(valor, flag: bool, requerido: bool, corte: date, umbral: int = UMBRAL_DEFECTO):
    """Devuelve (estado, vencimiento, dias, detalle) o None si el documento no aplica."""
    vacio = valor is None or (isinstance(valor, str) and not valor.strip())
    fecha = None if vacio else parsear_fecha(valor)
    dias = (fecha - corte).days if fecha else None

    if flag or (isinstance(valor, str) and es_pendiente(valor) and fecha is None):
        return PENDIENTE, fecha, dias, "Presentado, pendiente de aprobación"

    if vacio:
        if requerido:
            return VENCIDO, None, None, "Sin fecha cargada (faltante)"
        return None

    if fecha is not None:
        estado = clasificar_dias(dias, umbral)
        if estado == VENCIDO:
            detalle = "Vence hoy" if dias == 0 else f"Vencido hace {-dias} días"
        elif estado == POR_VENCER:
            detalle = f"Vence en {dias} días"
        else:
            detalle = ""
        return estado, fecha, dias, detalle

    if isinstance(valor, str):
        texto = valor.strip().lower()
        if texto in _NA:
            return None
        if texto in _FALTANTE:
            return VENCIDO, None, None, "Faltante"
    return VENCIDO, None, None, f"Dato inválido: {str(valor).strip()!r}"
