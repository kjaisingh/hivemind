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
    if (/^PT4\d{2}$/.test(error.code)) {
      databaseError.status = Number(error.code.slice(2));
      databaseError.expose = true;
    }
    throw databaseError;
  }
  return data;
}

export function isUniqueViolation(error) {
  return error?.code === '23505';
}

export async function readAll(query) {
  const pageSize = 500;
  const rows = [];
  query.order('id', { ascending: true });
  for (let offset = 0; ; offset += pageSize) {
    const page = unwrap(await query.range(offset, offset + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function readByIds(ids, queryForIds) {
  const rows = [];
  const uniqueIds = [...new Set(ids)];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    rows.push(...await readAll(queryForIds(uniqueIds.slice(offset, offset + 100))));
  }
  return rows;
}
