# Olygames

Olygames, c'est un petit parc d'attractions dans le navigateur : une plateforme de mini-jeux à jouer entre amis, en lobbies. Chaque jeu est une attraction, et la grande roue sert d'emblème au site.

Le premier jeu disponible est **Doublage Party** j'avais pense a un meilleur nom avec un jeu de mot avec dub mais je l'ai oublie, tant pis. Le principe tient en une phrase : tout le monde refait la bande-son d'une même vidéo, puis le groupe regarde les résultats et vote.

## Une partie de Doublage Party

Chaque joueur a un compte, avec juste un pseudo et une photo. L'host crée un lobby en piochant des vidéos dans la bibliothèque du site (une vidéo par manche), et les autres le rejoignent avec un code à 6 caractères.

À chaque manche, tout le monde double la même vidéo. Le son original reste audible pendant l'enregistrement pour se caler dessus, avec un bouton pour le couper si on préfère. Une prise dure exactement une lecture de la vidéo, ce qui garantit que le doublage reste synchronisé avec l'image, et on peut refaire sa prise autant de fois qu'on veut avant de valider. La phase se termine quand tout le monde a validé, ou quand l'host décide de couper court.

Ensuite, les doublages passent un par un, en même temps chez tous les joueurs, avec la vidéo en muet : on n'entend que la voix du doubleur. Puis vient le vote, sous forme d'un tableau avec une ligne par doublage qu'on peut revoir avant de trancher. Chacun donne -1, 0 ou +1, plus un super like à 2 points utilisable une seule fois par manche. Les votes sont publics et s'affichent en direct, ce qui fait partie du jeu.

Après la dernière manche : podium, classement complet, et trois trophées pour l'ambiance. Le Hater (le plus de -1 donnés), Le Liker (le plus de +1 donnés) et Le GOAT (le plus de super likes reçus).

## Comment c'est construit

Le front est en Angular 21. Derrière, Supabase gère la base de données, les comptes, le temps réel et le stockage des pistes audio. Les vidéos, elles, vivent sur Cloudflare R2, et le site est hébergé sur Netlify. L'ensemble tient dans les paliers gratuits de chaque service.

Le choix de R2 pour les vidéos n'est pas anodin : sa bande passante de sortie est gratuite et illimitée, ce qui est le point clé quand plusieurs joueurs streament la même vidéo en simultané. Les envois de vidéos passent par une Edge Function Supabase qui signe des URLs d'upload temporaires : le navigateur envoie ensuite le fichier directement à R2, et la clé secrète ne quitte jamais le serveur.

La synchronisation entre joueurs (qui a rejoint, où en est la partie, qui a voté quoi) repose sur le temps réel de Supabase. L'host pilote le déroulé : c'est lui, et lui seul, qui fait avancer les phases.

### Une architecture pensée multi-jeux

Le jeu de doublage n'est que le premier locataire. Le code sépare clairement ce qui est commun de ce qui est propre à chaque jeu :

```
src/app/
  core/       comptes, lobbies, joueurs, temps réel   (partagé par tous les jeux)
    models/game-registry.ts     le catalogue des jeux
  shared/     composants réutilisables (logo grande roue, tableau des scores)
  features/   écrans communs : connexion, hub, rejoindre, salle d'attente, vidéos
  games/
    dub/      le jeu de doublage, isolé et chargé à la demande
supabase/
  01-core.sql / 02-jeu-doublage.sql / 03-storage.sql
  functions/r2-upload-url/      signature des uploads R2
```

Côté base, la table `lobbies` porte un `game_id` en texte libre et un champ `settings` en JSON. Concrètement, ajouter un jeu revient à créer un dossier dans `games/`, le déclarer dans le registre et ajouter une route paresseuse. Un jeu aux réglages totalement différents ne demande aucune migration du noyau.

### La bibliothèque de vidéos

Tout le monde peut lire les vidéos pour jouer, mais seuls les comptes listés dans la table `admins` peuvent en ajouter ou en supprimer. Le verrou existe à trois niveaux : règles RLS sur la table `videos`, contrôle dans l'Edge Function qui signe les uploads, et masquage de l'écran côté interface. Ajouter un admin se fait en une ligne de SQL dans Supabase.

### Anti-triche

Les scores ne sont jamais envoyés par le navigateur. Ils sont recalculés par un trigger en base à chaque vote, et les règles RLS de Postgres empêchent de voter deux fois, de voter pour son propre doublage, ou de poser deux super likes dans la même manche.

### Limite assumée

L'host pilote la partie depuis son navigateur. S'il ferme son onglet en plein milieu, la partie reste bloquée sur la phase en cours. C'est le compromis pour rester à zéro euro, sans serveur permanent qui orchestrerait les parties.
