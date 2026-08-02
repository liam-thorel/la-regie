-- ============================================================
--  SUPPRESSION DES LOBBIES
--
--  Supprimer un lobby retire en cascade ses joueurs, manches, prises,
--  votes et phases : tout est déjà déclaré "on delete cascade".
--  À exécuter dans l'éditeur SQL Supabase.
-- ============================================================

-- ---------- Suppression par l'host ----------
-- En security definer pour que la cascade s'applique quelles que soient
-- les règles RLS des tables filles, tout en vérifiant que l'appelant est
-- bien l'host de ce lobby.
create or replace function public.delete_lobby(target_lobby uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.lobbies
    where id = target_lobby and host_id = auth.uid()
  ) then
    raise exception 'Seul l''host peut supprimer cette partie.';
  end if;

  delete from public.lobbies where id = target_lobby;
  return true;
end;
$$;

-- ---------- Ménage des parties abandonnées ----------
-- Une partie que personne n'a terminée (host parti en cours de route,
-- lobby créé puis oublié) resterait sinon en base indéfiniment.
create or replace function public.purge_old_lobbies()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  delete from public.lobbies
  where created_at < now() - interval '24 hours';

  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Pour automatiser ce ménage tous les jours à 4h du matin, activer
-- l'extension pg_cron dans Database > Extensions, puis exécuter :
--
--   select cron.schedule(
--     'purge-lobbies',
--     '0 4 * * *',
--     $$ select public.purge_old_lobbies(); $$
--   );
--
-- Sans ça, rien de grave : les lobbies abandonnés occupent très peu de
-- place, et la fonction reste appelable à la main.

-- ---------- Suppression des doublages audio par l'host ----------
-- Le stockage n'est pas concerné par les cascades SQL : sans cette règle,
-- les fichiers audio resteraient dans le bucket après la partie.
-- Chemin d'un doublage : <lobby_id>/<manche>/<user_id>/prise.webm
drop policy if exists "l'host nettoie les doublages de sa partie" on storage.objects;

create policy "l'host nettoie les doublages de sa partie"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'dubs'
    and exists (
      select 1 from public.lobbies l
      where l.id::text = (storage.foldername(name))[1]
        and l.host_id = auth.uid()
    )
  );
