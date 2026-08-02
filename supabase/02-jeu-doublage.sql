-- ============================================================
--  JEU : DOUBLAGE PARTY
--  À exécuter après 01-core.sql.
--  Tout ce qui est ici est propre au jeu de doublage : un autre
--  jeu ajoutera son propre fichier sans toucher au noyau.
-- ============================================================

-- ---------- Bibliothèque de vidéos ----------
-- Les fichiers vivent sur Cloudflare R2 ; on ne stocke que les métadonnées.
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete set null,
  title text not null,
  storage_key text not null,
  thumbnail_key text,
  duration_seconds int,
  created_at timestamptz not null default now()
);

alter table public.videos enable row level security;

create policy "bibliothèque lisible par les connectés"
  on public.videos for select
  to authenticated
  using (true);

create policy "chacun ajoute des vidéos"
  on public.videos for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "chacun gère ses propres vidéos"
  on public.videos for delete
  to authenticated
  using (owner_id = auth.uid());

-- ---------- Phase interne d'une manche ----------
-- Le noyau ne connaît que 'waiting' / 'in_game' / 'finished' ; le détail du
-- déroulé d'une manche de doublage vit ici.
create table public.dub_phases (
  lobby_id uuid primary key references public.lobbies (id) on delete cascade,
  phase text not null default 'recording'
    check (phase in ('recording', 'playback', 'voting', 'recap')),
  -- Index du doublage en cours de diffusion pendant la phase 'playback'.
  playback_index int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.dub_phases enable row level security;

create policy "phases lisibles par les connectés"
  on public.dub_phases for select
  to authenticated
  using (true);

create policy "seul l'host pilote les phases"
  on public.dub_phases for all
  to authenticated
  using (
    exists (select 1 from public.lobbies l where l.id = lobby_id and l.host_id = auth.uid())
  )
  with check (
    exists (select 1 from public.lobbies l where l.id = lobby_id and l.host_id = auth.uid())
  );

-- ---------- Vidéo de chaque manche ----------
create table public.lobby_rounds (
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  round_number int not null,
  video_id uuid not null references public.videos (id),
  primary key (lobby_id, round_number)
);

alter table public.lobby_rounds enable row level security;

create policy "manches lisibles par les connectés"
  on public.lobby_rounds for select
  to authenticated
  using (true);

create policy "seul l'host compose les manches"
  on public.lobby_rounds for insert
  to authenticated
  with check (
    exists (select 1 from public.lobbies l where l.id = lobby_id and l.host_id = auth.uid())
  );

-- ---------- Doublages enregistrés ----------
create table public.dubs (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  round_number int not null,
  player_id uuid not null references public.players (id) on delete cascade,
  audio_storage_path text not null,
  -- Le joueur peut refaire sa prise autant de fois qu'il veut : la ligne est
  -- écrasée à chaque nouvelle prise. Passe à true quand il clique sur
  -- "Valider", ce qui fige sa prise et signale qu'il est prêt.
  is_locked boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (lobby_id, round_number, player_id)
);

create index dubs_lobby_round_idx on public.dubs (lobby_id, round_number);

alter table public.dubs enable row level security;

create policy "doublages lisibles par les connectés"
  on public.dubs for select
  to authenticated
  using (true);

-- On ne dépose un doublage que pour soi.
create policy "chacun dépose son doublage"
  on public.dubs for insert
  to authenticated
  with check (
    exists (
      select 1 from public.players p
      where p.id = player_id and p.profile_id = auth.uid()
    )
  );

-- Refaire une prise remplace la précédente, tant qu'elle n'est pas validée.
create policy "chacun refait sa prise tant qu'il n'a pas validé"
  on public.dubs for update
  to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_id and p.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = player_id and p.profile_id = auth.uid()
    )
  );

-- ---------- Votes ----------
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  dub_id uuid not null references public.dubs (id) on delete cascade,
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  round_number int not null,
  voter_player_id uuid not null references public.players (id) on delete cascade,
  value int not null check (value in (-1, 0, 1, 2)),
  created_at timestamptz not null default now(),
  unique (dub_id, voter_player_id)
);

create index votes_lobby_round_idx on public.votes (lobby_id, round_number);

-- Un seul super like (valeur 2) par joueur et par manche.
create unique index votes_one_super_like_per_round
  on public.votes (lobby_id, round_number, voter_player_id)
  where value = 2;

alter table public.votes enable row level security;

-- Les votes sont visibles : on affiche qui a mis quoi.
create policy "votes lisibles par les connectés"
  on public.votes for select
  to authenticated
  using (true);

-- On vote pour soi-même en tant que votant, et jamais pour son propre doublage.
create policy "chacun vote une fois, pas pour soi"
  on public.votes for insert
  to authenticated
  with check (
    exists (
      select 1 from public.players p
      where p.id = voter_player_id and p.profile_id = auth.uid()
    )
    and not exists (
      select 1 from public.dubs d
      where d.id = dub_id and d.player_id = voter_player_id
    )
  );

-- ---------- Score : recalculé côté base, jamais envoyé par le client ----------
create or replace function public.apply_vote_to_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_player uuid;
begin
  select player_id into target_player from public.dubs where id = new.dub_id;

  update public.players
  set score = score + new.value
  where id = target_player;

  return new;
end;
$$;

create trigger on_vote_apply_score
  after insert on public.votes
  for each row
  execute function public.apply_vote_to_score();

-- ---------- Trophées de fin de partie ----------
-- Le Hater : le plus de -1 donnés. Le Liker : le plus de +1 donnés.
-- Le GOAT : le plus de super likes reçus.
create or replace view public.lobby_trophies as
with given as (
  select
    v.lobby_id,
    v.voter_player_id as player_id,
    count(*) filter (where v.value = -1) as dislikes_given,
    count(*) filter (where v.value = 1) as likes_given
  from public.votes v
  group by v.lobby_id, v.voter_player_id
),
received as (
  select
    v.lobby_id,
    d.player_id,
    count(*) filter (where v.value = 2) as super_likes_received
  from public.votes v
  join public.dubs d on d.id = v.dub_id
  group by v.lobby_id, d.player_id
)
select
  p.lobby_id,
  p.id as player_id,
  p.pseudo,
  p.avatar_url,
  p.score,
  coalesce(g.dislikes_given, 0) as dislikes_given,
  coalesce(g.likes_given, 0) as likes_given,
  coalesce(r.super_likes_received, 0) as super_likes_received
from public.players p
left join given g on g.lobby_id = p.lobby_id and g.player_id = p.id
left join received r on r.lobby_id = p.lobby_id and r.player_id = p.id;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.dub_phases;
alter publication supabase_realtime add table public.dubs;
alter publication supabase_realtime add table public.votes;
