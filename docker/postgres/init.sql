-- Runs once, when the compose volume is created. The compose service already
-- creates the kuutti role and the kuutti database from POSTGRES_USER/DB.
CREATE DATABASE kuutti_test OWNER kuutti;
