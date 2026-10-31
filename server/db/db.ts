// The office database: Postgres built into the server (PGlite, compiled to WebAssembly: no install, no service), for
// what keeps growing: shipped work, trophies, floor plans, the manager's look (migrations.ts has the tables). The live
// office stays in the state file. Its folder is <home>/db (demo-db for the demo); tests open one in memory.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS, type Migration } from './migrations.ts';

export type Db = PGlite;

/** Opens the database in `dir` (creating it the first time), or in memory when `dir` is null, with its tables up to date. */
export async function openDb(dir: string | null, migrations: readonly Migration[] = MIGRATIONS): Promise<Db> {
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const db = dir ? await PGlite.create(dir) : await PGlite.create();
  await migrate(db, migrations);
  return db;
}

/** Applies, in order, the migrations the database hasn't had yet, each in its own transaction. Returns their ids. */
export async function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<number[]> {
  await db.exec('create table if not exists schema_migrations (id integer primary key, name text not null, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ id: number }>('select id from schema_migrations')).rows.map((r) => r.id));
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('insert into schema_migrations (id, name) values ($1, $2)', [m.id, m.name]);
    });
    applied.push(m.id);
  }
  return applied;
}
