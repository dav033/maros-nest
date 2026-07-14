-- Permitir que un contacto comparta teléfono y/o email con su empresa u otro
-- contacto. La regla de duplicados pasa a nivel de aplicación: solo se bloquea
-- la MISMA persona (nombre + email + teléfono a la vez).
--
-- Si en la base de datos los índices ux_contacts_email_ci / ux_contacts_phone
-- se crearon como UNIQUE, bloquearían el guardado a nivel de BD aunque la
-- aplicación ya lo permita. Este script los recrea como índices NO únicos
-- (se conservan para acelerar las búsquedas por email/teléfono).
--
-- TypeORM corre con synchronize: false, así que hay que aplicarlo manualmente.
-- Es idempotente: se puede ejecutar varias veces sin problema.

-- Email (case-insensitive): índice no único sobre lower(email).
DROP INDEX IF EXISTS ux_contacts_email_ci;
CREATE INDEX IF NOT EXISTS ix_contacts_email_ci ON contacts (lower(email));

-- Teléfono: índice no único.
DROP INDEX IF EXISTS ux_contacts_phone;
CREATE INDEX IF NOT EXISTS ix_contacts_phone ON contacts (phone);
