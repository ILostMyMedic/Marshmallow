// The office database's tables, one migration at a time: db.ts applies the ones a database hasn't had, in order, and
// never again. Never edit a migration that has shipped; add the next one.

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'records, the player, floor plans',
    sql: `
      -- every merged PR, one row each: the shipped wall and the trophies come from these
      create table shipped (
        floor_id text not null,
        pr_number integer not null,
        title text not null,
        url text not null default '',
        built_by text,
        tested_by text,
        merged_at timestamptz not null,
        primary key (floor_id, pr_number)
      );
      create index shipped_by_time on shipped (merged_at desc);

      -- milestones, earned once (floor_id null: the company's)
      create table trophies (
        id text primary key,
        floor_id text,
        icon text not null,
        title text not null,
        detail text not null,
        earned_at timestamptz not null
      );

      -- the manager: their look in the game (one manager per office for now)
      create table player (
        key text primary key,
        look jsonb,
        updated_at timestamptz not null default now()
      );

      -- what stands in each of a floor's spots
      create table floor_items (
        floor_id text not null,
        spot text not null,
        item text not null,
        tier integer not null default 1,
        since timestamptz not null default now(),
        primary key (floor_id, spot)
      );
    `,
  },
  {
    id: 2,
    name: 'the world events',
    sql: `
      -- the world events' director, one row: when it picks the next event, and its random's state (mulberry32's, as a
      -- signed 32-bit number), so a restart carries on with the same schedule
      create table world_schedule (
        key text primary key,
        state integer not null,
        next_at timestamptz not null,
        updated_at timestamptz not null default now()
      );

      -- every world event that ran or runs now: what, on which side, its seed (so every tab draws it the same), and
      -- when it started and ends (moved earlier when it's cut short)
      create table world_events (
        id serial primary key,
        event text not null,
        side text not null,
        seed integer not null,
        forced boolean not null default false,
        started_at timestamptz not null,
        ends_at timestamptz not null
      );
      create index world_events_by_end on world_events (ends_at desc);
    `,
  },
];
