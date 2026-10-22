import { randomUUID } from 'node:crypto';

export function mockDatabase(tables) {
  return {
    from(table) {
      tables[table] ||= [];
      const filters = [];
      const orders = [];
      let action = 'select';
      let values;
      let start = 0;
      let end = Infinity;
      let single = false;
      let conflictKeys = [];
      let ignoreDuplicates = false;
      const query = {
        select() { return this; },
        eq(key, value) { filters.push((row) => row[key] === value); return this; },
        neq(key, value) { filters.push((row) => row[key] !== value); return this; },
        in(key, value) { filters.push((row) => value.includes(row[key])); return this; },
        lte(key, value) { filters.push((row) => row[key] <= value); return this; },
        gte(key, value) { filters.push((row) => row[key] >= value); return this; },
        order(key, { ascending = true } = {}) { orders.push({ key, ascending }); return this; },
        limit(count) { end = count - 1; return this; },
        range(from, to) { start = from; end = to; return this; },
        maybeSingle() { single = true; return this; },
        single() { single = true; return this; },
        update(data) { action = 'update'; values = data; return this; },
        delete() { action = 'delete'; return this; },
        insert(data) { action = 'insert'; values = Array.isArray(data) ? data : [data]; return this; },
        upsert(data, options) {
          action = 'upsert';
          values = Array.isArray(data) ? data : [data];
          conflictKeys = options.onConflict.split(',');
          ignoreDuplicates = options.ignoreDuplicates;
          return this;
        },
        then(resolve, reject) {
          let rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
          if (action === 'update') rows.forEach((row) => Object.assign(row, values));
          if (action === 'delete') tables[table] = tables[table].filter((row) => !rows.includes(row));
          if (action === 'insert') {
            if (table === 'EmailDeliveryLog' && values.some((value) => tables[table].some((row) => row.dedupeKey === value.dedupeKey))) {
              return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve, reject);
            }
            rows = values.map((value) => ({ id: randomUUID(), ...value }));
            tables[table].push(...rows);
          }
          if (action === 'upsert') {
            rows = values.map((value) => {
              const existing = tables[table].find((row) => conflictKeys.every((key) => row[key] === value[key]));
              if (existing) {
                if (!ignoreDuplicates) Object.assign(existing, value);
                return existing;
              }
              const row = { id: randomUUID(), ...value };
              tables[table].push(row);
              return row;
            });
          }
          rows.sort((a, b) => {
            for (const { key, ascending } of orders) {
              const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
              if (comparison) return ascending ? comparison : -comparison;
            }
            return 0;
          });
          rows = rows.slice(start, end + 1);
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}
