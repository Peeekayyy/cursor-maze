# Global Leaderboard Setup (Supabase)

The game works offline out of the box (scores stay local). To make the leaderboard
**global** so your friends share one board, do these one-time steps.

## 1. Create a free Supabase project
1. Go to https://supabase.com and sign up (free tier is plenty).
2. Click **New project**. Pick any name + a database password (you won't need the
   password for this game). Wait ~2 min for it to provision.

## 2. Create the `scores` table + access rules
Open **SQL Editor** (left sidebar) → **New query**, paste this, and click **Run**:

```sql
create table public.scores (
  id bigint generated always as identity primary key,
  name text not null,
  time_ms integer not null,
  created_at timestamptz not null default now()
);

-- turn on row-level security, then allow public read + validated insert (no edits/deletes)
alter table public.scores enable row level security;

create policy "public read" on public.scores
  for select using (true);

create policy "public insert" on public.scores
  for insert with check (
    time_ms between 200 and 1800000          -- 0.2s..30min: blocks 0/negative/absurd times
    and char_length(name) between 1 and 12
    and name ~ '^[A-Za-z0-9 _-]+$'           -- letters/digits/space/_/- only
  );
```

> **Anti-cheat note:** the `with check (...)` rule above is enforced by Postgres itself, so
> even though the publishable key ships in the page, nobody can write a zero/negative/absurd
> time or an oversized/garbage name — those inserts are rejected server-side. (A *plausible*
> fake time can't be prevented for any client-timed game, since the browser owns the clock.)
> If you already created the table with the looser rule, just re-run the
> `create policy "public insert" ...` block after a `drop policy if exists "public insert" on public.scores;`.

## 3. Copy your two keys
Go to **Project Settings → API**. Copy:
- **Project URL** — looks like `https://abcdwxyz.supabase.co`
- **anon public** key — a long token under "Project API keys" (the one labelled `anon` / `public`)

## 4. Paste them into the game
Open `index.html`, find this block near the top of the `<script>`:

```js
const SUPABASE_URL = "";        // e.g. "https://YOURREF.supabase.co"
const SUPABASE_ANON_KEY = "";   // your project's public "anon" key
```

Fill both in, e.g.:

```js
const SUPABASE_URL = "https://abcdwxyz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...your-long-anon-key...";
```

Save and reload — the GLOBAL TOP panel now reads/writes the shared board.

## 4b. (Optional) Keep only each player's best time
By default each completion inserts a new row, so a player can appear many times. To store
**only their fastest** (slower runs are never kept), run this once in the **SQL Editor**. It
cleans up existing duplicates, enforces one row per name, and installs a trigger that turns
every submit into a "keep the best" upsert — with the anti-cheat validation built in. No game
code change or redeploy is needed; the client keeps submitting normally.

```sql
-- 1) one-time cleanup: keep only each player's best existing row
delete from public.scores a
using public.scores b
where a.name = b.name
  and (b.time_ms < a.time_ms or (b.time_ms = a.time_ms and b.id < a.id));

-- 2) guarantee one row per name
alter table public.scores add constraint scores_name_unique unique (name);

-- 3) on every submit: validate, keep only the faster time, never store slower ones
create or replace function public.scores_keep_best()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.time_ms is null or new.time_ms < 200 or new.time_ms > 1800000 then
    raise exception 'invalid time';
  end if;
  if new.name is null
     or char_length(new.name) < 1 or char_length(new.name) > 12
     or new.name !~ '^[A-Za-z0-9 _-]+$' then
    raise exception 'invalid name';
  end if;
  if exists (select 1 from public.scores where name = new.name) then
    update public.scores
       set time_ms = new.time_ms
     where name = new.name and new.time_ms < time_ms;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists scores_keep_best on public.scores;
create trigger scores_keep_best
  before insert on public.scores
  for each row execute function public.scores_keep_best();
```

## 4c. (Required for levels) Per-level leaderboards
The game now has 3 size-based levels, each with its own leaderboard. Run this once in the
**SQL Editor** to add a `level` column and make "keep best" work per `(name, level)`. It
assumes you already ran section 4b; existing rows are treated as the original full-size
maze (level 3).

```sql
-- 1) add the level column (existing rows = level 3, the original maze)
alter table public.scores add column if not exists level smallint not null default 3;

-- 2) keep one best row per (name, level): clean dups, then swap the unique constraint
delete from public.scores a
using public.scores b
where a.name = b.name and a.level = b.level
  and (b.time_ms < a.time_ms or (b.time_ms = a.time_ms and b.id < a.id));

alter table public.scores drop constraint if exists scores_name_unique;
alter table public.scores add constraint scores_name_level_unique unique (name, level);

-- 3) update the keep-best trigger to match per (name, level) and validate the level
create or replace function public.scores_keep_best()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.time_ms is null or new.time_ms < 200 or new.time_ms > 1800000 then
    raise exception 'invalid time';
  end if;
  if new.name is null
     or char_length(new.name) < 1 or char_length(new.name) > 12
     or new.name !~ '^[A-Za-z0-9 _-]+$' then
    raise exception 'invalid name';
  end if;
  if new.level is null or new.level < 1 or new.level > 3 then
    raise exception 'invalid level';
  end if;

  if exists (select 1 from public.scores where name = new.name and level = new.level) then
    update public.scores
       set time_ms = new.time_ms
     where name = new.name and level = new.level and new.time_ms < time_ms;
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists scores_keep_best on public.scores;
create trigger scores_keep_best
  before insert on public.scores
  for each row execute function public.scores_keep_best();
```

After running this, scores submit and display per level. Until you run it, the game still
works — per-level scores just fall back to each browser's local storage.

## 4d. (Required for Breakout) Breakout high-score table
The Breakout game ranks players by **highest level reached** (tie-break by points), in its own
table. Run this once in the **SQL Editor**. It reuses the same project + player name as the
other games; until you run it, Breakout scores fall back to per-device local storage.

```sql
create table public.breakout_scores (
  id bigint generated always as identity primary key,
  name text not null,
  level smallint not null,
  score integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.breakout_scores enable row level security;

create policy "public read" on public.breakout_scores for select using (true);
create policy "public insert" on public.breakout_scores
  for insert with check (
    char_length(name) between 1 and 12 and name ~ '^[A-Za-z0-9 _-]+$'
    and level between 1 and 20 and score between 0 and 1000000
  );

-- one row per player, keeping their best (highest level, then highest score)
alter table public.breakout_scores add constraint breakout_name_unique unique (name);

create or replace function public.breakout_keep_best()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is null or char_length(new.name) < 1 or char_length(new.name) > 12
     or new.name !~ '^[A-Za-z0-9 _-]+$' then raise exception 'invalid name'; end if;
  if new.level < 1 or new.level > 20 then raise exception 'invalid level'; end if;
  if new.score < 0 or new.score > 1000000 then raise exception 'invalid score'; end if;

  if exists (select 1 from public.breakout_scores where name = new.name) then
    update public.breakout_scores
       set level = new.level, score = new.score
     where name = new.name
       and (new.level > level or (new.level = level and new.score > score));
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists breakout_keep_best on public.breakout_scores;
create trigger breakout_keep_best
  before insert on public.breakout_scores
  for each row execute function public.breakout_keep_best();
```

## 5. Host the file so friends can open it
`localhost:8123` only works on your machine. To share, put `index.html` on any static host:
- **Netlify Drop** (easiest): https://app.netlify.com/drop — drag `index.html` in, get a URL.
- **GitHub Pages**, **Vercel**, or **Cloudflare Pages** also work.

Send friends the URL. Everyone who plays writes to the same Supabase board.

---

## Notes / good to know
- The `anon` key is **meant to be public** (it ships in the client). Row-level security is
  what protects your data — the policies above allow only reads and validated inserts.
- Because it's a friends game, anyone with the page can submit a score (and could fake a
  time). That's fine for fun. If you later want anti-cheat, we'd add a server-side check or
  a signed submission — ask and I'll set it up.
- Want to wipe the board? In Supabase: **Table Editor → scores → delete rows**, or run
  `delete from public.scores;` in the SQL Editor.
