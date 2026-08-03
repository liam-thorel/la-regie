-- ============================================================
--  STOCKAGE SUPABASE
--  Buckets : photos de profil et pistes audio des doublages.
--  Les vidéos sources, elles, vivent sur Cloudflare R2.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('dubs', 'dubs', true)
on conflict (id) do nothing;

-- ---------- Avatars ----------
-- Chemin attendu : <user_id>/<fichier>
create policy "avatars visibles par tous"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "chacun dépose son avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "chacun remplace son avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- Doublages audio ----------
-- Chemin attendu : <lobby_id>/<round>/<user_id>/prise.webm
-- L'identifiant du joueur est un dossier : storage.foldername() ne lit que
-- les segments de dossier, jamais le nom du fichier.
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

-- Refaire une prise écrase le fichier précédent.
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
