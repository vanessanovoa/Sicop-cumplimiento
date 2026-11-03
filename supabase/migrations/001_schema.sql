-- SICOP · esquema base. Ejecutar en el SQL Editor de Supabase (en orden: 001, 002, 003).

create table public.perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text not null default '',
  rol text not null check (rol in ('admin','trabajador','revisor')),
  activo boolean not null default true,
  debe_cambiar_clave boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activa boolean not null default true,
  creada_en timestamptz not null default now()
);
create unique index organizaciones_nombre_uq on public.organizaciones (lower(nombre));

-- Catálogo de documentos que se ofrecen al dar de alta una entidad a mano.
create table public.tipos_documento (
  id serial primary key,
  categoria text not null check (categoria in ('Empleados','Vehículos','Proveedores')),
  nombre text not null,
  requerido boolean not null default true,
  orden int not null default 0,
  unique (categoria, nombre)
);
insert into public.tipos_documento (categoria, nombre, requerido, orden) values
  ('Empleados','Apto médico',true,1), ('Empleados','DNI',true,2), ('Empleados','Licencia de conducir',true,3),
  ('Empleados','Capacitación',true,4), ('Empleados','Entrega EPP',true,5),
  ('Vehículos','VTV',true,1), ('Vehículos','Póliza',true,2), ('Vehículos','Cuota',true,3),
  ('Vehículos','Formulario RA-15',false,4);

create table public.entidades (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id),
  tipo text not null check (tipo in ('empleado','vehiculo','proveedor')),
  etiqueta text not null,
  identificador text not null,          -- CUIL | dominio | "requisito|documento"
  subgrupo text not null default '',
  datos jsonb not null default '{}'::jsonb,
  archivada_en timestamptz,
  archivada_por uuid references auth.users(id),
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  actualizada_por uuid references auth.users(id)
);
create unique index entidades_clave_uq on public.entidades (org_id, tipo, identificador) where archivada_en is null;
create index entidades_org_idx on public.entidades (org_id);

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  entidad_id uuid not null references public.entidades(id) on delete cascade,
  nombre text not null,
  requerido boolean not null default true,
  vencimiento date,
  presentado boolean not null default false,   -- presentado y pendiente de aprobación
  no_aplica boolean not null default false,
  obs text not null default '',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id),
  unique (entidad_id, nombre)
);

create table public.importaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id),
  archivo text not null,
  por uuid references auth.users(id),
  fecha timestamptz not null default now(),
  resumen jsonb not null default '{}'::jsonb
);

create table public.app_settings (
  id int primary key default 1 check (id = 1),
  umbral_por_vencer int not null default 15 check (umbral_por_vencer between 1 and 90),
  usar_fecha_hoy boolean not null default true,
  fecha_corte date
);
insert into public.app_settings (id) values (1);
