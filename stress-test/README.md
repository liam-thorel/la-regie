# Stress test — Doublage Party

Simule une partie complète avec plusieurs joueurs en parallèle, contre ton
vrai projet Supabase et ton vrai bucket R2. Chaque joueur simulé est un
compte authentifié réel, avec sa propre session : le script emprunte
exactement les mêmes chemins que l'appli (mêmes règles RLS, même stockage),
sous charge concurrente, plutôt que de mesurer un débit brut hors contexte.

## Utilisation

```bash
cd stress-test
npm install
cp .env.example .env
```

Remplis `.env` avec l'URL et la clé anonyme de ton projet Supabase (les
mêmes que dans `src/environments/environment.ts`). Assure-toi aussi que
**Confirm email** est désactivé dans Supabase (Authentication → Sign In /
Providers → Email), sinon les comptes de test ne pourront jamais se
connecter — c'est le même réglage que le README principal recommande déjà
pour l'usage normal du jeu.

Il faut aussi qu'il y ait déjà au moins autant de vidéos dans la
bibliothèque que de manches à jouer (`ROUNDS_COUNT`).

```bash
npm run run
```

Le script :
1. crée (ou reconnecte) 10 comptes de test,
2. crée un lobby et le fait rejoindre par tous,
3. joue chaque manche : envoi des prises (upload + écriture base, en
   parallèle sur tous les joueurs), diffusion, vote (en parallèle),
4. affiche le classement final,
5. imprime un rapport de temps par étape (moyenne, p95, max, erreurs).

À la fin, il te donne la commande pour nettoyer cette partie de test.

## Nettoyer après coup

```bash
node cleanup.mjs <lobby_id> <run_id>
```

Les deux valeurs sont affichées à la fin de `run.mjs`. Ça supprime les
fichiers audio de test sur le stockage, puis le lobby (joueurs, manches,
prises, votes partent en cascade). Les 10 comptes de test restent par
défaut : ils ne coûtent rien et ne sont visibles de personne. Si tu veux
aussi les supprimer, ajoute `SUPABASE_SERVICE_ROLE_KEY` dans `.env` (clé
`service_role` du projet, dans Settings → API). Cette clé contourne toutes
les règles de sécurité : garde-la uniquement dans ce `.env` local, jamais
ailleurs, jamais commitée.

## Ce que ça vérifie concrètement

- Les règles RLS sous charge concurrente (10 écritures simultanées sur les
  mêmes tables), pas seulement en usage séquentiel comme lors des tests
  manuels.
- Le comportement du bucket `dubs` avec 10 uploads en parallèle.
- Les contraintes d'unicité (un seul vote par doublage, un seul super like
  par manche et par joueur) sous concurrence réelle.
- Le trigger de calcul de score et la vue des trophées avec un volume de
  votes réaliste.
- Les canaux Realtime avec 10 connexions simultanées (très loin des 200
  connexions gratuites de Supabase, donc sans risque à cette échelle).

## Ce que ça ne teste pas

Le script n'ouvre pas de vrais navigateurs : il n'exerce donc pas
l'enregistrement micro, la lecture vidéo synchronisée, ni l'interface elle-
même. C'est un test de charge sur Supabase et R2, pas un test de bout en
bout de l'expérience utilisateur.

## Changer l'échelle

`PLAYER_COUNT` et `ROUNDS_COUNT` dans `.env` sont libres. Pour vraiment
pousser au-delà d'une partie entre amis (50, 100 joueurs...), garde un œil
sur le palier gratuit Supabase (200 connexions Realtime simultanées, 5 Go
de bande passante par mois) : au-delà, il faudra regarder le palier payant.
