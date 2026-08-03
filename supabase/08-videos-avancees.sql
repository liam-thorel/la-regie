-- ============================================================
--  MINIATURES ET RENOMMAGE DES VIDÉOS
--
--  1. Bucket pour les images d'aperçu générées côté navigateur à
--     l'ajout d'une vidéo (une image, quelques dizaines de Ko).
--  2. Politique manquante : sans elle, aucune mise à jour de la table
--     videos n'est autorisée, RLS refuse tout par défaut.
--  À exécuter dans l'éditeur SQL Supabase.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

create policy "miniatures visibles par tous"
  on storage.objects for select
  using (bucket_id = 'thumbnails');

create policy "seuls les admins ajoutent des miniatures"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'thumbnails' and public.is_admin());

create policy "seuls les admins remplacent des miniatures"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'thumbnails' and public.is_admin());

create policy "seuls les admins renomment les vidéos"
  on public.videos for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
