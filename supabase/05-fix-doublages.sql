-- ============================================================
--  CORRECTIF : dépôt des doublages audio
--
--  Les règles précédentes lisaient le 3e segment du chemin, mais
--  storage.foldername() ne renvoie que les DOSSIERS, pas le nom du
--  fichier : le dépôt était donc toujours refusé.
--  Nouveau chemin : <lobby_id>/<manche>/<user_id>/prise.webm
--  Ajoute aussi la règle de mise à jour, nécessaire pour refaire une prise.
--  À exécuter dans l'éditeur SQL Supabase.
-- ============================================================

drop policy if exists "chacun dépose son propre doublage" on storage.objects;
drop policy if exists "doublages écoutables par les connectés" on storage.objects;

create policy "doublages écoutables par les connectés"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'dubs');

create policy "chacun dépose son propre doublage"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'dubs'
    and (storage.foldername(name))[3] = auth.uid()::text
  );

-- Refaire une prise écrase le fichier précédent : sans cette règle,
-- seule la toute première prise passerait.
create policy "chacun remplace sa propre prise"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'dubs'
    and (storage.foldername(name))[3] = auth.uid()::text
  )
  with check (
    bucket_id = 'dubs'
    and (storage.foldername(name))[3] = auth.uid()::text
  );
