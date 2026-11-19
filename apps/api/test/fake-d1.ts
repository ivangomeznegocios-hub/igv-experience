import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/** D1 mínima en memoria (sobre node:sqlite) para pruebas de la API. */
export function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  const dir = path.resolve(__dirname, '../../../packages/db/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) db.exec(stmt);
  }
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])), success: true, meta: {} }),
    raw: async () => {
      const s = db.prepare(sql);
      s.setReturnArrays?.(true);
      return s.all(...(args as any[]));
    },
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as any[]));
      return { success: true, meta: { changes: r.changes }, results: [] };
    },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: any[]) => Promise.all(list.map((s) => s.all())),
    exec: async (sql: string) => (db.exec(sql), { count: 1, duration: 0 }),
  } as unknown as D1Database;
}
