import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
}

export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export function unwrap({ data, error }) {
  if (error) {
    const databaseError = new Error(error.message);
    databaseError.code = error.code;
    databaseError.details = error.details;
    databaseError.hint = error.hint;
    throw databaseError;
  }
  return data;
}

export function isUniqueViolation(error) {
  return error?.code === '23505';
}
