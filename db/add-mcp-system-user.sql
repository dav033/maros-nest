-- El usuario con el que firma el MCP.
--
-- Tasks e invitaciones no admiten un autor nulo como los document scans: el
-- reporter de una tarea, su log de actividad y `user_invitations.invited_by_id`
-- necesitan un id real. El MCP se autentica con un token compartido y no
-- representa a ninguna persona, asi que en vez de firmar como un empleado
-- cualquiera firma como esta fila. En el log de actividad se ve a simple vista
-- que lo hizo el agente y no alguien del equipo.
--
-- TypeORM corre con synchronize: false, asi que esto se aplica a mano contra
-- Supabase. Idempotente: se puede volver a ejecutar.
--
-- Por que NO puede iniciar sesion, por tres caminos a la vez:
--   1. is_active = false — es la unica bandera que el guard de sesion aplica.
--   2. status = 'disabled' — y checkAccess() deniega cualquier cuenta asi.
--   3. El dominio .invalid esta reservado por el RFC 2606 y no resuelve nunca,
--      asi que nadie puede llegar a controlar este correo en Google.
-- role_id queda nulo a proposito: cero permisos efectivos. El MCP no se apoya en
-- el rol de esta fila (su guard es el token), asi que darle permisos solo
-- agrandaria el dano si la fila se reutilizara en otro sitio.

INSERT INTO users (email, name, role_id, is_active, user_type, status)
VALUES ('mcp-agent@maros.invalid', 'MCP (agente)', NULL, FALSE, 'internal', 'disabled')
ON CONFLICT (email) DO UPDATE
  SET name      = EXCLUDED.name,
      is_active = FALSE,
      status    = 'disabled',
      role_id   = NULL;

-- Comprobacion: debe devolver una fila, inactiva y sin rol.
-- SELECT id, email, name, role_id, is_active, status
-- FROM users WHERE email = 'mcp-agent@maros.invalid';
