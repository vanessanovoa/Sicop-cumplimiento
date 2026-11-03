# SICOP · Puesta en marcha (para quien administra la cuenta de la empresa)

SICOP es un sitio estático (carpeta `docs/`) que usa **Supabase** como base de datos y para el inicio de sesión.
Todo esto debe crearse **con la cuenta de la empresa**, no con una cuenta personal. Tiempo estimado: 30–40 minutos.

## 1. Crear el proyecto Supabase
1. Ingresá a <https://supabase.com> con la cuenta de la empresa → **New project**.
2. Elegí una región cercana (por ejemplo *South America – São Paulo*) y una contraseña de base de datos larga (guardala en el gestor de contraseñas de la empresa).
3. Los datos incluyen CUIL y estado de aptos médicos: se recomienda un **plan con respaldos diarios** y sin pausa por inactividad (el plan gratuito se pausa tras una semana sin uso y no hace respaldos).

## 2. Cerrar las altas públicas
En **Authentication → Sign In / Providers** dejá activo *Email* y **desactivá “Allow new users to sign up”**. Sin esto cualquiera podría crearse una cuenta (igual no vería datos gracias a los permisos, pero no debe poder hacerlo).
Las cuentas las crea el administrador desde la pantalla *Usuarios* (quedan con el correo ya confirmado).

## 3. Crear las tablas y los permisos
En **SQL Editor** ejecutá, **en este orden y uno por vez**, el contenido de:
1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_rls.sql`
3. `supabase/migrations/003_funciones.sql`

Cada uno debe terminar con *Success*. Los permisos (quién puede ver, editar, archivar, importar) se aplican **en la base de datos** (RLS), no solo en la pantalla.

## 4. Desplegar la función de usuarios
Esta función permite que un administrador cree cuentas sin exponer la clave de servicio. Con la [CLI de Supabase](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <ID_DEL_PROYECTO>
supabase functions deploy usuarios-admin
```
(El ID figura en *Project Settings → General*.) No hace falta configurar secretos: Supabase inyecta `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el servidor.

## 5. Crear el primer administrador
1. **Authentication → Users → Add user → Create new user**: correo y contraseña del dueño de la app, con *Auto Confirm User* activado.
2. En el **SQL Editor** ejecutá (con ese correo):
   ```sql
   select public.bootstrap_admin('correo-del-administrador@empresa.com');
   ```
   Solo funciona mientras no exista ningún administrador. Desde ahí, ese usuario crea al resto desde la pantalla **Usuarios**.

## 6. Conectar el sitio
1. **Project Settings → API**: copiá *Project URL* y la clave **anon / public**.
2. Editá `docs/js/config.js` y pegalas:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
   La clave *anon* es pública por diseño. **Nunca** pongas la clave `service_role` en el sitio.
3. Publicá la carpeta `docs/` (GitHub Pages con la rama `main` y carpeta `/docs`, u otro hosting estático).
4. En **Authentication → URL Configuration** poné la URL del sitio como *Site URL*.

## 7. Uso semanal
1. El administrador ingresa → **Organizaciones**: crea las empresas (una sola vez).
2. Cada lunes: **Importar Excel** → arrastra los archivos → elige la organización de cada uno → revisa el resumen → *Importar*.
   El Excel **reemplaza** los datos de esa organización (solo de las hojas que trae). Lo que ya no figura se **archiva** (recuperable). Si alguien editó a mano desde la última carga, el resumen lo advierte antes de confirmar.
3. Entre cargas: **Empleados / Vehículos / Proveedores** → clic en una fila para editar fechas y marcas, o *Agregar*.
4. Los jefes (rol *Revisor*) ven el panel y descargan el PDF.

### Roles
| | Administrador | Trabajador | Revisor |
|---|:-:|:-:|:-:|
| Ver panel y descargar PDF | ✔ | ✔ | ✔ |
| Editar y agregar entidades | ✔ | ✔ | — |
| Archivar, restaurar, eliminar | ✔ | — | — |
| Importar Excel, organizaciones, parámetros, usuarios | ✔ | — | — |

## Seguridad y límites a tener presentes
- Las contraseñas iniciales las define el administrador; cada persona **debe cambiarla** en su primer ingreso. Sin servidor de correo (SMTP) propio no hay “olvidé mi contraseña”: el administrador la restablece desde **Usuarios**.
- No hay historial de cambios: la importación semanal pisa las ediciones manuales de esa organización (se avisa antes). Lo archivado se recupera; lo eliminado definitivamente, no.
- El archivo Excel original contiene una hoja `sicop` con credenciales: **no se sube** (la app solo lee Empleados, Vehículos y Proveedores). Igualmente no guardes el Excel en el repositorio (`.gitignore` ya lo excluye).
- Revisá con quien corresponda en la empresa el tratamiento de datos personales (CUIL completos visibles para todos los roles, por decisión del negocio).

## Verificar que quedó bien (checklist)
1. Ingresar con el administrador → entra al panel vacío / a *Importar*.
2. Crear una organización e importar el Excel de muestra: debe verse el panel con datos.
3. Crear un usuario *Revisor* y otro *Trabajador*; ingresar con cada uno en otra ventana privada: debe pedir cambio de contraseña.
4. Con el *Revisor*: solo lectura y PDF, sin botones de edición ni menú de administración.
5. Con el *Trabajador*: puede editar y agregar, no ve *Archivar* ni *Importar*.
6. Desactivar a un usuario desde **Usuarios**: su sesión deja de ver datos.

## Probar sin Supabase (solo en tu computadora)
Con un servidor local (`python3 -m http.server --directory docs`) abrí `http://localhost:8000/?dev&rol=admin` (o `rol=trabajador` / `rol=revisor`). Usa datos **en memoria** que se pierden al recargar; sirve para ver la interfaz de cada rol. Solo funciona en `localhost`.

## Pruebas automáticas
```bash
npm install
SICOP_MUESTRA="/ruta/al/excel.xlsx" npm test
```
Incluye pruebas de las migraciones SQL con roles simulados (administrador, trabajador, revisor, usuario desactivado y anónimo) sobre PGlite, de la función de usuarios y de la conversión del Excel.
