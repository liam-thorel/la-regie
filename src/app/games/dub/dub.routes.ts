import { Routes } from '@angular/router';

/**
 * Routes du jeu de doublage. Chaque jeu de la plateforme expose son propre
 * fichier de routes, chargé paresseusement : le bundle d'un jeu n'est
 * téléchargé que si on y joue.
 */
export const DUB_ROUTES: Routes = [
  {
    path: 'creer',
    loadComponent: () => import('./setup/dub-setup').then((m) => m.DubSetup),
  },
  {
    path: ':lobbyId/manche',
    loadComponent: () => import('./round/dub-round').then((m) => m.DubRound),
  },
  {
    path: ':lobbyId/diffusion',
    loadComponent: () => import('./playback/dub-playback').then((m) => m.DubPlayback),
  },
  {
    path: ':lobbyId/vote',
    loadComponent: () => import('./voting/dub-voting').then((m) => m.DubVoting),
  },
  {
    path: ':lobbyId/podium',
    loadComponent: () => import('./podium/dub-podium').then((m) => m.DubPodium),
  },
];
