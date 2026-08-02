-- ============================================================
--  NOYAU DE LA PLATEFORME (commun à tous les jeux)
--  À exécuter en premier dans l'éditeur SQL de Supabase.
-- ============================================================

-- ---------- Profils ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  pseudo text not null check (char_length(pseudo) between 2 and 24),
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Tout le monde peut lire les profils : on affiche pseudo et photo des
-- adversaires pendant les parties.
create policy "profils lisibles par les connectés"
  on public.profiles for select
  to authenticated
  using (true);

create policy "chacun crée son profil"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "chacun modifie son profil"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------- Code de lobby lisible ----------
-- Alphabet sans I, O, 0, 1 pour éviter les confusions à l'oral.
create or replace function public.generate_lobby_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text;
  attempt int := 0;
begin
  loop
    result := '';
    for i in 1..6 loop
      result := result || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;

    exit when not exists (
      select 1 from public.lobbies
      where code = result and status <> 'finished'
    );

    attempt := attempt + 1;
    if attempt > 50 then
      raise exception 'Impossible de générer un code de lobby unique.';
    end if;
  end loop;

  return result;
end;
$$;

-- ---------- Lobbies ----------
create table public.lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null default public.generate_lobby_code(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  -- Identifiant du jeu ('doublage', puis les suivants). Volontairement du
  -- texte libre : ajouter un jeu ne demande aucune migration ici.
  game_id text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'in_game', 'finished')),
  -- Réglages propres au jeu. Pour le doublage :
  -- { "videoIds": ["...", "..."] }
  settings jsonb not null default '{}'::jsonb,
  rounds_count int not null check (rounds_count between 1 and 20),
  current_round int not null default 0,
  created_at timestamptz not null default now()
);

create index lobbies_code_idx on public.lobbies (code) where status = 'waiting';

alter table public.lobbies enable row level security;

create policy "lobbies lisibles par les connectés"
  on public.lobbies for select
  to authenticated
  using (true);

create policy "chacun crée son lobby en tant qu'host"
  on public.lobbies for insert
  to authenticated
  with check (host_id = auth.uid());

-- Seul l'host pilote le déroulé de la partie.
create policy "seul l'host modifie le lobby"
  on public.lobbies for update
  to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

-- ---------- Joueurs ----------
create table public.players (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  pseudo text not null,
  avatar_url text,
  score int not null default 0,
  joined_at timestamptz not null default now(),
  unique (lobby_id, profile_id)
);

create index players_lobby_idx on public.players (lobby_id);

alter table public.players enable row level security;

create policy "joueurs lisibles par les connectés"
  on public.players for select
  to authenticated
  using (true);

-- On ne rejoint que pour soi-même, et seulement une partie pas encore lancée.
create policy "chacun rejoint pour lui-même"
  on public.players for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.lobbies l
      where l.id = lobby_id and l.status = 'waiting'
    )
  );

-- Le score n'est jamais modifié par le client : il est recalculé côté base
-- par les triggers du jeu (voir 02-jeu-doublage.sql). Le joueur ne peut
-- toucher qu'à son pseudo/avatar affichés.
create policy "chacun met à jour sa propre ligne"
  on public.players for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.lobbies;
alter publication supabase_realtime add table public.players;
