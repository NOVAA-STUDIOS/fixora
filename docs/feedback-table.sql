-- Feedback table for Fixora. Run once in the Supabase SQL editor.
--
-- TWO DELIBERATE CHANGES from the original draft, both load-bearing:
--
-- 1. `is_public`. Feedback written in a private in-app dialog must not appear on a public website
--    because someone later decided to build a wall out of it. The user ticks a box; nothing is
--    published without it. Default false, so the safe answer is the one you get by doing nothing.
--
-- 2. A public SELECT policy. The draft had only `auth.uid() = user_id`, which means an anonymous
--    website visitor can read NOTHING — the wall would have rendered empty forever. Public reads
--    are scoped to exactly what is meant to be public: consented, commented, 4★ and above.
--
-- The two SELECT policies are OR'd by Postgres, so a signed-in user still sees all of their own
-- feedback (including 1★ and private) while the world sees only the consented subset.

create table if not exists public.feedback (
  id uuid default gen_random_uuid() primary key,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  app_version text,
  created_at timestamptz default now(),
  user_id uuid references auth.users(id) on delete set null,
  -- Explicit consent to appear on the public feedback wall.
  is_public boolean not null default false
);

alter table public.feedback enable row level security;

-- Anyone may submit, signed in or not. Sign-in is optional in Fixora, and feedback that required
-- an account would silently exclude most of the people worth hearing from.
create policy "insert_feedback"
  on public.feedback for insert
  with check (true);

-- A signed-in user can always read their own, whatever the rating or consent flag.
create policy "read_own"
  on public.feedback for select
  using (auth.uid() = user_id);

-- The public wall. Consented AND has something to say AND is a positive review — the last of which
-- is a product decision (a testimonial section), not a privacy one.
create policy "read_public_reviews"
  on public.feedback for select
  using (is_public = true and comment is not null and rating >= 4);

-- The website filters on these three columns on every request; without the index that is a full
-- scan per page view.
create index if not exists feedback_public_idx
  on public.feedback (created_at desc)
  where is_public = true and comment is not null and rating >= 4;

-- NOTE: no UPDATE or DELETE policy is defined, so RLS denies both to everyone using the anon key.
-- Feedback is append-only from the app's point of view; moderation happens in the Supabase
-- dashboard, which bypasses RLS via the service role.
