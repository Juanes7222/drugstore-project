-- Allow the application role to connect so the server can run with RLS FORCE
-- active. The password is not stored here: assign it per environment (dev:
-- `ALTER ROLE pharmacy_app LOGIN PASSWORD '...'`, prod: secret manager).
ALTER ROLE pharmacy_app LOGIN;
