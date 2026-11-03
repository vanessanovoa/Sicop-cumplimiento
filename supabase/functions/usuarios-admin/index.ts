// Edge Function `usuarios-admin`. Despliegue: `supabase functions deploy usuarios-admin`.
// Usa la service_role SOLO acá (variable SUPABASE_SERVICE_ROLE_KEY que Supabase inyecta en el servidor).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { manejar, ErrorUsuario } from "./logica.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Identidad: se valida el JWT con Auth; nunca se confía en datos del cuerpo.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = token ? await admin.auth.getUser(token) : { data: { user: null } };

  const ok = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new ErrorUsuario(r.error.message);
    return r.data;
  };
  const db = {
    perfilDe: async (id: string) => ok(await admin.from("perfiles").select("*").eq("user_id", id).maybeSingle()),
    listarPerfiles: async () => ok(await admin.from("perfiles").select("*").order("creado_en")),
    contarAdminsActivos: async () => {
      const r = await admin.from("perfiles").select("user_id", { count: "exact", head: true }).eq("rol", "admin").eq("activo", true);
      if (r.error) throw new ErrorUsuario(r.error.message);
      return r.count ?? 0;
    },
    crearUsuarioAuth: async (email: string, password: string) => {
      const r = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (r.error || !r.data.user) throw new ErrorUsuario(r.error?.message ?? "No se pudo crear el usuario");
      return { id: r.data.user.id };
    },
    insertarPerfil: async (p: Record<string, unknown>) => ok(await admin.from("perfiles").insert(p)),
    actualizarPerfil: async (id: string, c: Record<string, unknown>) => ok(await admin.from("perfiles").update(c).eq("user_id", id)),
    setBan: async (id: string, baneado: boolean) => {
      const r = await admin.auth.admin.updateUserById(id, { ban_duration: baneado ? "876000h" : "none" });
      if (r.error) throw new ErrorUsuario(r.error.message);
    },
    cambiarClave: async (id: string, password: string) => {
      const r = await admin.auth.admin.updateUserById(id, { password });
      if (r.error) throw new ErrorUsuario(r.error.message);
    },
    borrarUsuarioAuth: async (id: string) => { await admin.auth.admin.deleteUser(id); },
  };

  try {
    const body = await req.json().catch(() => ({}));
    return json(await manejar(body, u.user?.id ?? null, db));
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Error interno" }, 500);
  }
});
