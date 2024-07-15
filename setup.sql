BEGIN;

CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  position VARCHAR(50)
);
