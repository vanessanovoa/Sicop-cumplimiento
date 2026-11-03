-- ===== 001_schema.sql =====
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

-- ===== 002_rls.sql =====
-- SICOP · seguridad. Todas las tablas con RLS; el rol sale de public.perfiles (nunca del cliente).
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where user_id = auth.uid() and activo
$$;
create or replace function public.soy_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() = 'admin', false)
$$;
create or replace function public.puedo_editar() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('admin','trabajador'), false)
$$;
create or replace function public.estoy_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_rol() is not null
$$;
revoke all on function public.mi_rol(), public.soy_admin(), public.puedo_editar(), public.estoy_activo() from public, anon;
grant execute on function public.mi_rol(), public.soy_admin(), public.puedo_editar(), public.estoy_activo() to authenticated;

alter table public.perfiles enable row level security;
alter table public.organizaciones enable row level security;
alter table public.tipos_documento enable row level security;
alter table public.entidades enable row level security;
alter table public.documentos enable row level security;
alter table public.importaciones enable row level security;
alter table public.app_settings enable row level security;

-- Lectura: cualquier usuario activo.
create policy leer_perfiles on public.perfiles for select to authenticated using (public.estoy_activo() or user_id = auth.uid());
create policy leer_orgs on public.organizaciones for select to authenticated using (public.estoy_activo());
create policy leer_tipos on public.tipos_documento for select to authenticated using (public.estoy_activo());
create policy leer_entidades on public.entidades for select to authenticated using (public.estoy_activo());
create policy leer_documentos on public.documentos for select to authenticated using (public.estoy_activo());
create policy leer_importaciones on public.importaciones for select to authenticated using (public.estoy_activo());
create policy leer_settings on public.app_settings for select to authenticated using (public.estoy_activo());

-- Escritura directa: administración solo admin; entidades/documentos admin o trabajador.
create policy admin_orgs on public.organizaciones for all to authenticated using (public.soy_admin()) with check (public.soy_admin());
create policy admin_tipos on public.tipos_documento for all to authenticated using (public.soy_admin()) with check (public.soy_admin());
create policy admin_settings on public.app_settings for update to authenticated using (public.soy_admin()) with check (public.soy_admin());
-- perfiles: sin escritura desde el cliente (la Edge Function usa service_role; ver clave_cambiada()).
create policy editar_entidades_ins on public.entidades for insert to authenticated with check (public.puedo_editar() and archivada_en is null);
create policy editar_entidades_upd on public.entidades for update to authenticated using (public.puedo_editar()) with check (public.puedo_editar());
create policy borrar_entidades on public.entidades for delete to authenticated using (public.soy_admin() and archivada_en is not null);
create policy editar_docs_ins on public.documentos for insert to authenticated with check (public.puedo_editar());
create policy editar_docs_upd on public.documentos for update to authenticated using (public.puedo_editar()) with check (public.puedo_editar());
create policy borrar_docs on public.documentos for delete to authenticated using (public.puedo_editar());
-- importaciones: solo las escribe la función de importación (security definer).

-- Un trabajador no puede archivar ni restaurar.
create or replace function public.trg_entidades_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.archivada_en is distinct from old.archivada_en or new.archivada_por is distinct from old.archivada_por)
     and not public.soy_admin() then
    raise exception 'Solo un administrador puede archivar o restaurar' using errcode = '42501';
  end if;
  if new.org_id <> old.org_id or new.tipo <> old.tipo then
    raise exception 'No se puede cambiar la organización ni el tipo de una entidad' using errcode = '42501';
  end if;
  new.actualizada_en := now();
  new.actualizada_por := auth.uid();
  return new;
end $$;
create trigger entidades_guardia before update on public.entidades
  for each row execute function public.trg_entidades_guardia();

create or replace function public.trg_documentos_sello() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;
create trigger documentos_sello before update on public.documentos
  for each row execute function public.trg_documentos_sello();

-- El usuario marca que ya cambió su clave inicial.
create or replace function public.clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update public.perfiles set debe_cambiar_clave = false where user_id = auth.uid()
$$;
revoke all on function public.clave_cambiada() from public, anon;
grant execute on function public.clave_cambiada() to authenticated;

-- Primer administrador: se ejecuta UNA vez desde el SQL Editor (rol postgres). Falla si ya existe un admin.
create or replace function public.bootstrap_admin(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare u auth.users;
begin
  if exists (select 1 from public.perfiles where rol = 'admin') then
    raise exception 'Ya existe un administrador';
  end if;
  select * into u from auth.users where lower(email) = lower(p_email);
  if u.id is null then raise exception 'No existe el usuario % en Authentication', p_email; end if;
  insert into public.perfiles (user_id, email, nombre, rol, activo, debe_cambiar_clave)
  values (u.id, u.email, split_part(u.email,'@',1), 'admin', true, false)
  on conflict (user_id) do update set rol = 'admin', activo = true;
end $$;
revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;

-- ===== 003_funciones.sql =====
-- SICOP · operaciones atómicas: importar Excel, guardar entidad, archivar.

-- Importa una organización: el Excel "pisa todo" (solo los tipos de p_tipos; null = todos). p_entidades = [{tipo, etiqueta, identificador, subgrupo, datos,
--   documentos:[{nombre, requerido, vencimiento, presentado, no_aplica}]}]
create or replace function public.importar_organizacion(p_org uuid, p_entidades jsonb, p_archivo text, p_tipos text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e jsonb; d jsonb; v_id uuid; v_arch timestamptz;
  n_nuevas int := 0; n_act int := 0; n_rest int := 0; n_arch int := 0; n_docs int := 0;
  vistas uuid[] := '{}';
begin
  if not public.soy_admin() then raise exception 'Solo un administrador puede importar' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizaciones where id = p_org) then raise exception 'Organización inexistente'; end if;
  if jsonb_typeof(p_entidades) <> 'array' then raise exception 'Formato inválido'; end if;

  for e in select * from jsonb_array_elements(p_entidades) loop
    select id, archivada_en into v_id, v_arch from public.entidades
      where org_id = p_org and tipo = e->>'tipo' and identificador = e->>'identificador'
      order by (archivada_en is null) desc, actualizada_en desc limit 1;
    if v_id is null then
      insert into public.entidades (org_id, tipo, etiqueta, identificador, subgrupo, datos, actualizada_por)
      values (p_org, e->>'tipo', e->>'etiqueta', e->>'identificador', coalesce(e->>'subgrupo',''),
              coalesce(e->'datos','{}'::jsonb), auth.uid()) returning id into v_id;
      n_nuevas := n_nuevas + 1;
    else
      if v_arch is not null then n_rest := n_rest + 1; else n_act := n_act + 1; end if;
      update public.entidades set etiqueta = e->>'etiqueta', subgrupo = coalesce(e->>'subgrupo',''),
        datos = coalesce(e->'datos','{}'::jsonb), archivada_en = null, archivada_por = null where id = v_id;
    end if;
    vistas := vistas || v_id;
    -- documentos: los que el Excel ya no trae se borran
    delete from public.documentos where entidad_id = v_id
      and nombre not in (select x->>'nombre' from jsonb_array_elements(coalesce(e->'documentos','[]'::jsonb)) x);
    for d in select * from jsonb_array_elements(coalesce(e->'documentos','[]'::jsonb)) loop
      insert into public.documentos (entidad_id, nombre, requerido, vencimiento, presentado, no_aplica, obs, actualizado_por)
      values (v_id, d->>'nombre', coalesce((d->>'requerido')::boolean, true), nullif(d->>'vencimiento','')::date,
              coalesce((d->>'presentado')::boolean,false), coalesce((d->>'no_aplica')::boolean,false), '', auth.uid())
      on conflict (entidad_id, nombre) do update set requerido = excluded.requerido, vencimiento = excluded.vencimiento,
        presentado = excluded.presentado, no_aplica = excluded.no_aplica, obs = '';
      n_docs := n_docs + 1;
    end loop;
  end loop;

  with a as (
    update public.entidades set archivada_en = now(), archivada_por = auth.uid()
    where org_id = p_org and archivada_en is null and not (id = any(vistas))
      and (p_tipos is null or tipo = any(p_tipos)) returning 1)
  select count(*) into n_arch from a;

  insert into public.importaciones (org_id, archivo, por, resumen)
  values (p_org, p_archivo, auth.uid(), jsonb_build_object('nuevas', n_nuevas, 'actualizadas', n_act,
          'restauradas', n_rest, 'archivadas', n_arch, 'documentos', n_docs));
  return jsonb_build_object('nuevas', n_nuevas, 'actualizadas', n_act, 'restauradas', n_rest,
                            'archivadas', n_arch, 'documentos', n_docs);
end $$;
revoke all on function public.importar_organizacion(uuid, jsonb, text, text[]) from public, anon;
grant execute on function public.importar_organizacion(uuid, jsonb, text, text[]) to authenticated;

-- Alta o edición de una entidad con sus documentos. p_esperada = actualizada_en que vio el usuario (control optimista).
create or replace function public.guardar_entidad(p_id uuid, p_org uuid, p_esperada timestamptz, p_ent jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_act timestamptz; d jsonb;
begin
  if not public.puedo_editar() then raise exception 'Sin permiso para editar' using errcode = '42501'; end if;
  if v_id is null then
    insert into public.entidades (org_id, tipo, etiqueta, identificador, subgrupo, datos, actualizada_por)
    values (p_org, p_ent->>'tipo', p_ent->>'etiqueta', p_ent->>'identificador', coalesce(p_ent->>'subgrupo',''),
            coalesce(p_ent->'datos','{}'::jsonb), auth.uid()) returning id into v_id;
  else
    select actualizada_en into v_act from public.entidades where id = v_id and archivada_en is null for update;
    if v_act is null then raise exception 'La entidad no existe o está archivada'; end if;
    if p_esperada is not null and v_act <> p_esperada then
      raise exception 'CONFLICTO: otra persona modificó esta entidad' using errcode = '40001';
    end if;
    update public.entidades set etiqueta = p_ent->>'etiqueta', subgrupo = coalesce(p_ent->>'subgrupo',''),
      datos = coalesce(p_ent->'datos','{}'::jsonb), identificador = p_ent->>'identificador' where id = v_id;
  end if;
  delete from public.documentos where entidad_id = v_id
    and nombre not in (select x->>'nombre' from jsonb_array_elements(coalesce(p_ent->'documentos','[]'::jsonb)) x);
  for d in select * from jsonb_array_elements(coalesce(p_ent->'documentos','[]'::jsonb)) loop
    insert into public.documentos (entidad_id, nombre, requerido, vencimiento, presentado, no_aplica, obs, actualizado_por)
    values (v_id, d->>'nombre', coalesce((d->>'requerido')::boolean,true), nullif(d->>'vencimiento','')::date,
            coalesce((d->>'presentado')::boolean,false), coalesce((d->>'no_aplica')::boolean,false),
            coalesce(d->>'obs',''), auth.uid())
    on conflict (entidad_id, nombre) do update set requerido = excluded.requerido, vencimiento = excluded.vencimiento,
      presentado = excluded.presentado, no_aplica = excluded.no_aplica, obs = excluded.obs;
  end loop;
  update public.entidades set actualizada_en = now(), actualizada_por = auth.uid() where id = v_id;
  return v_id;
end $$;
revoke all on function public.guardar_entidad(uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.guardar_entidad(uuid, uuid, timestamptz, jsonb) to authenticated;

create or replace function public.archivar_entidad(p_id uuid, p_archivar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.soy_admin() then raise exception 'Solo un administrador puede archivar' using errcode = '42501'; end if;
  update public.entidades set archivada_en = case when p_archivar then now() end,
    archivada_por = case when p_archivar then auth.uid() end where id = p_id;
end $$;
revoke all on function public.archivar_entidad(uuid, boolean) from public, anon;
grant execute on function public.archivar_entidad(uuid, boolean) to authenticated;

