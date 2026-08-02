-- ============================================================
--  ADMINISTRATION DE LA BIBLIOTHÈQUE DE VIDÉOS
--  Seuls les comptes listés dans admins peuvent ajouter ou
--  supprimer des vidéos. Tout le monde peut toujours les lire.
--  À exécuter après 02-jeu-doublage.sql.
-- ============================================================

create table public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Personne ne peut lire ni modifier cette table depuis le navigateur :
-- aucune policy n'est créée, donc tout accès client est refusé.
-- Seules les fonctions en security definer ci-dessous la consultent.

insert into public.admins (email) values ('letoasterliam@gmail.com');

-- Vrai si l'utilisateur connecté est administrateur.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ---------- Remplacement des règles sur les vidéos ----------
drop policy if exists "chacun ajoute des vidéos" on public.videos;
drop policy if exists "chacun gère ses propres vidéos" on public.videos;

create policy "seuls les admins ajoutent des vidéos"
  on public.videos for insert
  to authenticated
  with check (owner_id = auth.uid() and public.is_admin());

create policy "seuls les admins suppriment des vidéos"
  on public.videos for delete
  to authenticated
  using (public.is_admin());

-- La lecture reste ouverte à tous les joueurs : la policy
-- "bibliothèque lisible par les connectés" de 02-jeu-doublage.sql est
-- conservée telle quelle.

-- ---------- Pour ajouter un autre administrateur plus tard ----------
-- insert into public.admins (email) values ('autre@exemple.com');
