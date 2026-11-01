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
  {
    id: 3,
    name: 'floor previews',
    sql: `
      -- what the manager set for each floor's preview (null: the office decides); kept for a floor that leaves, as its
      -- plan is. Whether a preview runs isn't kept: after a restart every preview is stopped.
      create table preview_settings (
        floor_id text primary key,
        command text,
        port integer,
        updated_at timestamptz not null default now()
      );
    `,
  },
  {
    id: 4,
    name: 'the desktop: chats, proposals, discussions',
    sql: `
      -- the manager's chats with the CEO, one per idea; each resumes its own CEO session, so ideas don't mix
      create table chats (
        id serial primary key,
        title text not null,
        session_id text,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create index chats_by_update on chats (updated_at desc);

      -- sender: manager, ceo or office (the office's own lines: a project started, a reply that failed)
      create table chat_messages (
        id serial primary key,
        chat_id integer not null references chats (id) on delete cascade,
        at timestamptz not null,
        sender text not null,
        text text not null,
        proposal_id integer
      );
      create index chat_messages_by_chat on chat_messages (chat_id, id);

      -- the projects the CEO proposes in a chat: repo and tasks as JSON, as shared/types.ts has them
      create table proposals (
        id serial primary key,
        chat_id integer not null references chats (id) on delete cascade,
        at timestamptz not null,
        status text not null,
        repo jsonb not null,
        brief text not null,
        team_size integer not null,
        tasks jsonb not null,
        step text,
        floor_id text,
        issue_numbers jsonb not null default '[]',
        error text,
        decided_at timestamptz
      );
      create index proposals_by_chat on proposals (chat_id);

      -- threads the CEO opens to settle something with the manager; context: where it was opened, for its first job
      create table discussions (
        id serial primary key,
        title text not null,
        floor_id text,
        status text not null,
        outcome text,
        context text not null default '',
        session_id text,
        opened_at timestamptz not null,
        updated_at timestamptz not null
      );
      create index discussions_by_update on discussions (updated_at desc);

      create table discussion_messages (
        id serial primary key,
        discussion_id integer not null references discussions (id) on delete cascade,
        at timestamptz not null,
        sender text not null,
        text text not null
      );
      create index discussion_messages_by_discussion on discussion_messages (discussion_id, id);
    `,
  },
];
