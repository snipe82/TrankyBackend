-- Crea o sincroniza el rol y las bases de Tranky dentro del contenedor Postgres.
-- No contiene credenciales: npm run db:create inyecta los valores del .env como variables de psql
-- (db_user, db_password, db_name, db_name_test).

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user') \gexec

-- Mantiene la contraseña del rol igual a DB_PASSWORD del .env.
SELECT format('ALTER ROLE %I PASSWORD %L', :'db_user', :'db_password') \gexec

SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8''', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

-- Base aislada para la suite de pruebas (npm test la recrea en cada ejecución).
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8''', :'db_name_test', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name_test') \gexec

\connect :db_name
SELECT format('ALTER SCHEMA public OWNER TO %I', :'db_user') \gexec

\connect :db_name_test
SELECT format('ALTER SCHEMA public OWNER TO %I', :'db_user') \gexec
