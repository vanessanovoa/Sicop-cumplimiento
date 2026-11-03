import unittest
from datetime import date

from sicop.rules import AL_DIA, PENDIENTE, POR_VENCER, VENCIDO, evaluar, es_pendiente

HOY = date(2026, 11, 2)


def est(valor, flag=False, req=True):
    r = evaluar(valor, flag, req, HOY)
    return r[0] if r else None


class Reglas(unittest.TestCase):
    def test_limites(self):
        self.assertEqual(est(date(2026, 11, 2)), VENCIDO)      # 0 días
        self.assertEqual(est(date(2026, 11, 3)), POR_VENCER)   # 1 día
        self.assertEqual(est(date(2026, 11, 17)), POR_VENCER)  # 15 días
        self.assertEqual(est(date(2026, 11, 18)), AL_DIA)      # 16 días

    def test_pendiente(self):
        self.assertEqual(est(date(2050, 1, 1), flag=True), PENDIENTE)
        self.assertEqual(est("1 - presentado"), PENDIENTE)
        self.assertTrue(es_pendiente(1.0))
        self.assertFalse(es_pendiente("11/1272039"))

    def test_texto_y_vacios(self):
        self.assertIsNone(est("NA"))
        self.assertIsNone(est(None, req=False))
        self.assertEqual(est(None), VENCIDO)
        self.assertEqual(est("FALTANTE"), VENCIDO)
        self.assertEqual(est("16/6/2026"), VENCIDO)
        self.assertEqual(est("basura"), VENCIDO)


if __name__ == "__main__":
    unittest.main()
