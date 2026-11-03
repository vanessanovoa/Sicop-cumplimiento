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
