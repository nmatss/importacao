ALTER TABLE import_processes
  ALTER COLUMN logistic_status SET DEFAULT 'consolidation';

UPDATE import_processes
  SET logistic_status = 'consolidation'
  WHERE logistic_status IS NULL OR logistic_status = '';
