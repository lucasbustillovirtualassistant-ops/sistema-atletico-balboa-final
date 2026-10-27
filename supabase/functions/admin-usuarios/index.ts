// Administración de usuarios del Sistema Atlético Balboa.
// Solo un DUEÑO activo puede usarla. La clave de administrador vive aquí, en el servidor,
// nunca en la página.
//   accion "crear": { email, password, nombre, rol }
//   accion "clave": { user_id, password }   (restablecer contraseña olvidada)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ROLES = ['dueno', 'gerente', 'secretaria', 'porteria'];
const MIN_CLAVE = 10;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (estado: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1) ¿Quién llama? Debe ser un dueño activo.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: quien, error: errorQuien } = await admin.auth.getUser(jwt);
  if (errorQuien || !quien?.user) return responder(401, { error: 'Sesión inválida' });

  const { data: perfil } = await admin
    .from('perfiles')
    .select('rol, activo')
    .eq('user_id', quien.user.id)
    .maybeSingle();
  if (!perfil || perfil.rol !== 'dueno' || !perfil.activo) {
    return responder(403, { error: 'Solo un dueño puede administrar usuarios' });
  }

  let datos: Record<string, unknown>;
  try {
    datos = await req.json();
  } catch {
    return responder(400, { error: 'Datos inválidos' });
  }

  const password = String(datos.password ?? '');
  // La misma regla que Supabase Auth: la API de administrador no siempre la aplica.
  if (password.length < MIN_CLAVE || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return responder(400, { error: `La contraseña debe tener al menos ${MIN_CLAVE} caracteres, con letras y números` });
  }

  // 2) Crear usuario con rol
  if (datos.accion === 'crear') {
    const email = String(datos.email ?? '').trim().toLowerCase();
    const nombre = String(datos.nombre ?? '').trim() || null;
    const rol = String(datos.rol ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responder(400, { error: 'Correo inválido' });
    if (!ROLES.includes(rol)) return responder(400, { error: 'Rol inválido' });

    const { data: creado, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      const yaExiste = /already|registered|exists/i.test(error.message);
      return responder(yaExiste ? 409 : 400, {
        error: yaExiste ? 'Ya existe un usuario con ese correo' : error.message,
      });
    }

    // El trigger de la base ya creó el perfil vacío; aquí se le pone nombre y rol.
    const { error: errorPerfil } = await admin
      .from('perfiles')
      .upsert({ user_id: creado.user.id, email, nombre, rol, activo: true });
    if (errorPerfil) return responder(500, { error: 'Usuario creado, pero falló asignar el rol: ' + errorPerfil.message });

    return responder(200, { ok: true, user_id: creado.user.id });
  }

  // 3) Restablecer contraseña de otro usuario
  if (datos.accion === 'clave') {
    const userId = String(datos.user_id ?? '');
    if (userId === quien.user.id) {
      return responder(400, { error: 'Para tu propia contraseña usa "Mi cuenta"' });
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return responder(400, { error: error.message });
    return responder(200, { ok: true });
  }

  return responder(400, { error: 'Acción desconocida' });
});
