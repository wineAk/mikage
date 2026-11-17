CREATE ROLE mikage_data_owner NOLOGIN;
GRANT mikage_data_owner TO mikage_maintenance;
GRANT USAGE ON SCHEMA mikage TO mikage_data_owner;
GRANT USAGE ON SCHEMA mikage TO mikage_maintenance;

ALTER TABLE mikage.logs OWNER TO mikage_data_owner;
ALTER TABLE mikage.incidents OWNER TO mikage_data_owner;
