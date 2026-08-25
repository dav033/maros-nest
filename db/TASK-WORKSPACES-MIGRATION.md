# Migración SQL de Task Workspaces

Este documento describe cómo aplicar los scripts SQL incluidos en este directorio.

## Orden obligatorio

Ejecutar desde `maros-nest`, con una conexión PostgreSQL respaldada y con las tablas CRM, `tasks` y `users` ya creadas:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/create-task-workspaces.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrate-task-workspaces.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/validate-task-workspaces.sql
```

También se puede usar cualquier cliente PostgreSQL equivalente, manteniendo el mismo orden.

## Alcance de cada script

1. `create-task-workspaces.sql` crea de forma idempotente los workspaces, enlaces, carpetas y `task_files`; agrega las columnas de workspace a `tasks`; crea índices, restricciones y el workspace `General Tasks`.
2. `migrate-task-workspaces.sql` corre dentro de una transacción. Crea un workspace canónico por lead, enlaza leads/proyectos/contactos/compañías, asigna tareas históricas a su workspace o a `General Tasks`, y copia las claves de `tasks.attachments` a `task_files` sin borrar el JSONB legacy.
3. `validate-task-workspaces.sql` es de solo lectura. Devuelve diagnósticos para workspace general, duplicados canónicos, carpetas mal asociadas, propietarios inválidos, archivos pendientes, tareas sin workspace y paridad entre adjuntos legacy y `task_files`.

## Criterios de validación

Después del backfill, estos diagnósticos deben ser `0`:

- `duplicate_canonical_workspaces`
- `tasks_with_invalid_folder_owner`
- `files_with_invalid_owner`
- `tasks_with_missing_workspace`
- `legacy_attachment_file_count_mismatch`

`legacy_attachment_rows` puede ser mayor que `0`: es esperado porque el backfill conserva el campo legacy para rollback y comparación.

## Seguridad y rollback

- Hacer backup antes de ejecutar en producción.
- `create` y `migrate` son idempotentes para poder reintentarse tras un fallo.
- El backfill conserva `tasks.attachments`; no eliminar esa columna hasta verificar el nuevo flujo y contar con un backup.
- Si la transacción del backfill falla, PostgreSQL revierte sus cambios. Para deshacer una ejecución ya confirmada se debe restaurar el backup o ejecutar un rollback revisado sobre una copia, porque este paquete no borra datos históricos automáticamente.

## Estado de esta ejecución

Los scripts fueron creados, compilados indirectamente con el backend y versionados. No se ejecutaron contra una base de datos viva durante esta sesión porque no había una conexión PostgreSQL autorizada/configurada.
