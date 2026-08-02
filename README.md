# La Régie

Plateforme de jeux à jouer entre amis dans le navigateur, en lobbies.
Premier jeu disponible : **Doublage Party**, où chacun refait la bande-son
d'une vidéo, puis le groupe vote.

Stack : Angular 21 + Supabase (base, comptes, temps réel, stockage audio) +
Cloudflare R2 (vidéos) + Netlify (hébergement). Tout tient dans les paliers
gratuits.

---

## 1. Supabase

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Dans l'éditeur SQL, exécuter dans l'ordre :
   - `supabase/01-core.sql` (noyau commun à tous les jeux)
   - `supabase/02-jeu-doublage.sql` (tables du jeu de doublage)
   - `supabase/03-storage.sql` (buckets avatars et doublages audio)
3. Dans **Authentication > Providers**, garder Email activé. Pour tester
   entre amis sans friction, désactiver la confirmation par email dans
   **Authentication > Sign In / Providers > Email**.
4. Récupérer l'URL du projet et la clé `anon` dans **Settings > API**, puis
   les reporter dans `src/environments/environment.ts`.

## 2. Cloudflare R2 (vidéos)

1. Créer un bucket R2 (10 Go gratuits, et surtout **bande passante de sortie
   gratuite et illimitée**, ce qui est le point clé pour diffuser des vidéos
   à plusieurs joueurs en même temps).
2. Activer l'accès public du bucket (domaine `r2.dev` ou domaine
   personnalisé), puis reporter cette URL dans `r2PublicBaseUrl` des fichiers
   d'environnement.
3. Dans les paramètres CORS du bucket, autoriser les méthodes `GET` et `PUT`
   depuis l'origine du site (en local `http://localhost:4200`, puis l'URL
   Netlify une fois déployé). Sans ça, les envois de vidéos échouent.
4. Créer un jeton d'API R2 avec droits de lecture et écriture, puis déployer
   l'Edge Function qui signe les URLs d'upload :

```bash
supabase functions deploy r2-upload-url
supabase secrets set \
  R2_ACCOUNT_ID=xxx \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_BUCKET=nom-du-bucket
```

La clé secrète R2 ne quitte jamais le serveur : le navigateur demande une URL
temporaire, puis envoie le fichier directement à R2.

## 3. Lancer en local

```bash
npm install
npm start
```

Le site tourne sur `http://localhost:4200`.

Note : l'enregistrement micro exige un contexte sécurisé. `localhost` est
accepté par les navigateurs, mais pour tester depuis un téléphone sur le
réseau local il faudra du HTTPS (ou passer par le site déployé).

## 4. Déployer sur Netlify

- Commande de build : `npm run build`
- Dossier à publier : `dist/dub-game/browser`
- La redirection SPA est déjà incluse (`public/_redirects`), sinon un
  rechargement sur `/lobby/xxx` renverrait une 404.

---

## Comment on joue

1. Chacun crée un compte (pseudo + photo, rien d'autre).
2. L'host ajoute des vidéos dans la bibliothèque, puis crée un lobby en
   choisissant les vidéos. Une vidéo = une manche.
3. Les autres rejoignent avec le code à 6 caractères.
4. À chaque manche, tout le monde double la même vidéo. Le son original est
   audible pendant l'enregistrement (avec un bouton pour le couper), et une
   prise dure exactement une lecture de la vidéo pour rester calée sur
   l'image. On peut refaire sa prise autant qu'on veut, puis on valide.
5. L'enregistrement se termine quand tout le monde a validé, ou quand l'host
   coupe court.
6. Les doublages passent un par un, en même temps chez tous les joueurs, avec
   la vidéo en muet : seul le doublage s'entend.
7. Vient ensuite le vote : un tableau avec une ligne par doublage, qu'on peut
   revoir avant de trancher. On donne -1, 0 ou +1, plus un super like à 2
   points utilisable une seule fois par manche. Les votes sont publics et
   s'affichent en direct.
8. Après la dernière manche : podium, classement complet et trophées.
   Le Hater (le plus de -1 donnés), Le Liker (le plus de +1 donnés),
   Le GOAT (le plus de super likes reçus).

---

## Architecture

Le projet est pensé pour accueillir d'autres jeux sans rien casser.

```
src/app/
  core/       comptes, lobbies, joueurs, temps réel   (partagé par tous les jeux)
    models/game-registry.ts     le catalogue des jeux
  shared/     composants réutilisables (tableau des scores)
  features/   écrans communs : connexion, hub, rejoindre, salle d'attente, vidéos
  games/
    dub/      le jeu de doublage, isolé et chargé à la demande
supabase/
  01-core.sql / 02-jeu-doublage.sql / 03-storage.sql
  functions/r2-upload-url/      signature des uploads R2
```

### Ajouter un jeu

1. Créer `src/app/games/<mon-jeu>/` avec ses écrans et son `<mon-jeu>.routes.ts`.
2. Ajouter une entrée dans `core/models/game-registry.ts`.
3. Ajouter une route paresseuse dans `app.routes.ts`.
4. Si le jeu a ses propres tables, créer un `supabase/0X-<mon-jeu>.sql`.

Le noyau n'a pas à être modifié : la table `lobbies` porte un `game_id` en
texte libre et un champ `settings` en JSON, donc un jeu aux réglages
totalement différents ne demande aucune migration.

### Anti-triche

Les scores ne sont jamais envoyés par le navigateur. Ils sont recalculés par
un trigger en base à chaque vote, et les règles RLS de Postgres empêchent de
voter deux fois, de voter pour son propre doublage, ou de poser deux super
likes dans la même manche. Seul l'host peut faire avancer les phases.

### Limite connue

L'host pilote le déroulé de la partie depuis son navigateur. S'il ferme son
onglet en plein milieu, la partie reste bloquée sur la phase en cours. C'est
le compromis assumé pour rester à zéro euro sans serveur permanent.
