-- Enlace manual de un proyecto del CRM con un job de QuickBooks.
--
-- Safe to re-run: todo va con IF NOT EXISTS y no toca ni borra datos.
--
-- 1) Garantiza la columna y el indice unico parcial de los que depende el
--    enlace (ya los crea db/add-project-qbo-customer-id.sql; aqui se repiten
--    para que esta migracion sea autosuficiente y siga siendo idempotente).
-- 2) Crea la bitacora de enlaces. Hasta ahora romper o crear un vinculo no
--    dejaba rastro en ninguna tabla — solo en el log de la aplicacion — asi
--    que no habia forma de reconstruir despues que job estuvo enganchado a que
--    proyecto, ni quien lo engancho. Con el selector manual en la ficha el
--    vinculo ya no lo escribe solo la importacion, y esa trazabilidad pasa a
--    ser necesaria.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS qbo_customer_id varchar(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_qbo_customer_id_unique
  ON projects (qbo_customer_id)
  WHERE qbo_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_qbo_link_events (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL,
  -- 'link' | 'unlink'. Texto libre a proposito: un CHECK obligaria a migrar la
  -- tabla para anadir una accion nueva, y esto es una bitacora, no un estado.
  action varchar(20) NOT NULL,
  previous_qbo_customer_id varchar(50),
  new_qbo_customer_id varchar(50),
  -- Numero de proyecto y nombre del job tal como estaban al escribir la fila:
  -- si despues se renombra el job en QuickBooks, la bitacora sigue diciendo
  -- que se enlazo en su momento.
  project_number varchar(50),
  job_display_name varchar(255),
  actor_email varchar(255),
  created_at timestamp NOT NULL DEFAULT now()
);

-- El proyecto se borra con su lead; la bitacora no debe impedirlo ni arrastrar
-- la fila, por eso NO hay clave foranea: es historico, sobrevive al proyecto.
CREATE INDEX IF NOT EXISTS idx_project_qbo_link_events_project_id
  ON project_qbo_link_events (project_id, created_at DESC);
