# SICOP · Control de cumplimiento (versión web)

Sitio estático (`docs/`) + Supabase (inicio de sesión, base de datos y permisos). El administrador importa los Excel cada lunes y,
entre cargas, el equipo edita, agrega y archiva entidades desde formularios. Los jefes consultan el panel y descargan el PDF.

- **Puesta en marcha (TI de la empresa):** `README-SUPABASE.md`
- **Crear el repositorio del empleador:** `GUIA-REPOSITORIO.md`
- **Versión local alternativa (Python/Streamlit):** `README.md`

## Estructura
```
docs/                    sitio publicable (GitHub Pages: rama main, carpeta /docs)
  js/rules.js            motor de reglas (Vencido / Por vencer / Pendiente / Al día)
  js/loader.js           lectura del Excel SICOP (corre en un Web Worker: js/worker.bundle.js)
  js/modelo.js           entidades <-> filas del Excel, vista previa de importación
  js/backend/            supabase.js (real) y memoria.js (solo ?dev en localhost)
  js/views/              panel, entidades (listas + ficha), importar, administración
supabase/migrations/     001 esquema · 002 permisos (RLS) · 003 importar / guardar / archivar
supabase/functions/usuarios-admin/   alta y gestión de usuarios (solo administradores)
tests/                   pruebas automáticas
```

## Desarrollo
```bash
npm install
SICOP_MUESTRA="/ruta/al/excel.xlsx" npm test       # reglas, Excel, SQL/RLS, usuarios, interfaz
npm run build                                       # regenera docs/js/worker.bundle.js (si cambia src/worker.js)
python3 -m http.server --directory docs 8000        # luego http://localhost:8000/?dev&rol=admin
```
`?dev` (solo en localhost) usa datos en memoria; `rol=admin|trabajador|revisor`, `muestra=archivo.xlsx` y `demo` permiten ver cada perfil.
