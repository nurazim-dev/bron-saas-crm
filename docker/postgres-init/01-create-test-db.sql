-- Create test database alongside default dev database
SELECT 'CREATE DATABASE zapis_test OWNER zapis'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'zapis_test')\gexec
