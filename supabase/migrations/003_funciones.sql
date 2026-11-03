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
