#!/bin/sh
# Runs once, when the database volume is first created.
#
# Creates the least-privileged role the application connects as. The
# migrations grant it exactly the privileges it needs and no more; this only
# gives it a password and the right to connect.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'stackkeeper_app') then
    create role stackkeeper_app login password '${APP_DB_PASSWORD:-stackkeeper_app}';
  else
    alter role stackkeeper_app login password '${APP_DB_PASSWORD:-stackkeeper_app}';
  end if;
end
\$\$;

alter role stackkeeper_app nobypassrls nosuperuser nocreatedb nocreaterole;
grant connect on database "$POSTGRES_DB" to stackkeeper_app;
SQL
