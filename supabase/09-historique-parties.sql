-- ============================================================
--  HISTORIQUE DES PARTIES
--
--  Une partie est aujourd'hui supprimée entièrement à la fermeture
--  (joueurs, votes, prises...). Sans rien d'autre, il ne resterait donc
--  aucune trace pour calculer des statistiques de profil une fois la
--  partie fermée.
--
--  Ce fichier archive un résumé par joueur (score, classement, trophées)
--  automatiquement dès qu'une partie passe au statut 'finished' — pas
--  seulement à la fermeture manuelle par l'host, pour couvrir aussi le
--  ménage automatique des lobbies abandonnés (purge_old_lobbies). La ligne
--  archivée est indépendante du lobby d'origine : le supprimer plus tard
--  ne touche pas à l'historique.
--
--  Générique multi-jeux : `trophies` est un tableau de clés libres
--  (ex: {'hater','goat'}) plutôt que des colonnes fixes, pour qu'un futur
--  jeu avec d'autres trophées n'exige aucune migration ici.
--
--  À exécuter après 02-jeu-doublage.sql.
-- ============================================================

create table public.game_results (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  game_id text not null,
  lobby_id uuid references public.lobbies (id) on delete set null,
  score int not null,
  placement int not null,       -- 1 = premier ; les ex-aequo partagent le même rang
  player_count int not null,
  trophies text[] not null default '{}',
  played_at timestamptz not null default now()
);

create index game_results_profile_game_idx on public.game_results (profile_id, game_id);

alter table public.game_results enable row level security;

-- Chacun ne consulte que son propre historique. Pas de policy d'insertion :
-- seule la fonction ci-dessous (security definer) peut écrire ici, jamais
-- le client directement.
create policy "chacun lit son propre historique"
  on public.game_results for select
  to authenticated
  using (profile_id = auth.uid());

-- ---------- Archivage automatique à la fin d'une partie de doublage ----------
create or replace function public.archive_dub_results()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.game_results (profile_id, game_id, lobby_id, score, placement, player_count, trophies)
  with given as (
    select v.voter_player_id as player_id,
      count(*) filter (where v.value = -1) as dislikes_given,
      count(*) filter (where v.value = 1) as likes_given
    from public.votes v
    where v.lobby_id = new.id
    group by v.voter_player_id
  ),
  received as (
    select d.player_id,
      count(*) filter (where v.value = 2) as super_likes_received
    from public.votes v
    join public.dubs d on d.id = v.dub_id
    where v.lobby_id = new.id
    group by d.player_id
  ),
  stats as (
    select
      p.profile_id,
      p.score,
      coalesce(g.dislikes_given, 0) as dislikes_given,
      coalesce(g.likes_given, 0) as likes_given,
      coalesce(r.super_likes_received, 0) as super_likes_received
    from public.players p
    left join given g on g.player_id = p.id
    left join received r on r.player_id = p.id
    where p.lobby_id = new.id
  ),
  bounds as (
    select
      max(dislikes_given) as max_dislikes,
      max(likes_given) as max_likes,
      max(super_likes_received) as max_super,
      count(*) as player_count
    from stats
  )
  select
    s.profile_id,
    new.game_id,
    new.id,
    s.score,
    rank() over (order by s.score desc),
    b.player_count,
    array_remove(
      array[
        case when b.max_dislikes > 0 and s.dislikes_given = b.max_dislikes then 'hater' end,
        case when b.max_likes > 0 and s.likes_given = b.max_likes then 'liker' end,
        case when b.max_super > 0 and s.super_likes_received = b.max_super then 'goat' end
      ],
      null
    )
  from stats s
  cross join bounds b;

  return new;
end;
$$;

create trigger on_lobby_finished_archive
  after update on public.lobbies
  for each row
  when (new.status = 'finished' and old.status is distinct from 'finished' and new.game_id = 'doublage')
  execute function public.archive_dub_results();

-- ---------- Rattrapage ponctuel ----------
-- Si des parties de doublage sont déjà terminées (status = 'finished') mais
-- pas encore supprimées au moment où tu exécutes ce fichier, ce bloc les
-- archive rétroactivement. Un simple "update ... set status = 'finished'"
-- ne suffirait pas : le trigger ne se déclenche que sur un changement réel
-- de statut, donc on fait transiter chaque lobby déjà terminé par un état
-- intermédiaire avant de le repasser à 'finished'. La liste des lobbies
-- concernés est figée au départ, donc ça ne touche à aucune partie en
-- cours à ce moment-là. Sans effet sur les parties déjà supprimées :
-- leurs données n'existent plus, impossible de les récupérer.
do $$
declare
  finished_ids uuid[];
begin
  select array_agg(id) into finished_ids
  from public.lobbies
  where status = 'finished' and game_id = 'doublage';

  if finished_ids is not null then
    update public.lobbies set status = 'in_game' where id = any(finished_ids);
    update public.lobbies set status = 'finished' where id = any(finished_ids);
  end if;
end $$;
