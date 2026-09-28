-- Renombra el TIPO DE USUARIO 'client' a 'external'.
--
-- Por que: "cliente" ya significa otra cosa en este CRM — contacts.is_client y
-- companies.is_client marcan a quien nos compra. Usar la misma palabra para "persona
-- de fuera con acceso a la aplicacion" era ambiguo. Esas banderas NO se tocan aqui.
--
-- TypeORM corre con synchronize: false, asi que esto se aplica a mano contra Supabase.
-- Todo es idempotente y se puede re-ejecutar.
--
-- Alcance: users.user_type, su CHECK, y el rol de sistema sembrado como 'client'.

-- --------------------------------------------------------------------------
-- 1. El valor de users.user_type
--
-- El CHECK se suelta antes del UPDATE: con el constraint viejo puesto, escribir
-- 'external' fallaria fila por fila. Se vuelve a crear despues, ya con el valor nuevo.
-- --------------------------------------------------------------------------

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;

UPDATE users SET user_type = 'external' WHERE user_type = 'client';

ALTER TABLE users
  ADD CONSTRAINT users_user_type_check CHECK (user_type IN ('internal', 'external'));

-- --------------------------------------------------------------------------
-- 2. El rol sembrado
--
-- `roles.name` es unico y el rol es is_system, asi que se renombra en sitio: los
-- usuarios que lo tengan asignado conservan su role_id y sus permisos. Si una base ya
-- tiene ambos nombres no se hace nada: fusionarlos seria decidir por el administrador.
-- --------------------------------------------------------------------------

UPDATE roles
SET name = 'external',
    description = 'Invited external user. Starts with no permissions until data scoping is enforced'
WHERE name = 'client'
  AND NOT EXISTS (SELECT 1 FROM roles other WHERE other.name = 'external');
