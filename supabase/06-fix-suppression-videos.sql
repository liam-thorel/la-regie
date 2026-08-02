-- ============================================================
--  CORRECTIF : suppression des vidéos
--
--  lobby_rounds référence videos sans règle de suppression : dès qu'une
--  vidéo a servi dans un lobby, Postgres refuse de la supprimer.
--  On passe la contrainte en "on delete cascade" : supprimer une vidéo
--  retire aussi les manches des anciennes parties qui l'utilisaient.
--  Les scores et les trophées, eux, vivent dans players et votes et ne
--  sont pas touchés.
--  À exécuter dans l'éditeur SQL Supabase.
-- ============================================================

alter table public.lobby_rounds
  drop constraint if exists lobby_rounds_video_id_fkey;

alter table public.lobby_rounds
  add constraint lobby_rounds_video_id_fkey
  foreign key (video_id) references public.videos (id) on delete cascade;

-- Vérification : la requête doit renvoyer true pour le compte admin.
-- select public.is_admin();
