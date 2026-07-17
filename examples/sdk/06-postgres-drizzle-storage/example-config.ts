export const POSTGRES_REFERENCE_DATABASE_URL = process.env.HEDDLE_POSTGRES_DATABASE_URL
  ?? 'postgresql://heddle:heddle@127.0.0.1:54329/heddle_reference';
