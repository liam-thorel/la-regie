import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';
import { adminGuard } from './core/guards/admin-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'signup',
    loadComponent: () => import('./features/auth/signup/signup').then((m) => m.Signup),
  },
  {
    path: 'mot-de-passe-oublie',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password').then((m) => m.ForgotPassword),
  },
  {
    path: 'nouveau-mot-de-passe',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password').then((m) => m.ResetPassword),
  },

  // ---- Noyau, commun à tous les jeux ----
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
      {
        path: 'rejoindre',
        loadComponent: () =>
          import('./features/lobby/join-lobby/join-lobby').then((m) => m.JoinLobby),
      },
      {
        path: 'rejoindre/:code',
        loadComponent: () =>
          import('./features/lobby/join-lobby/join-lobby').then((m) => m.JoinLobby),
      },
      {
        path: 'profil',
        loadComponent: () =>
          import('./features/profile/profile-page').then((m) => m.ProfilePage),
      },
      {
        path: 'videos',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/video-library/video-library-page').then((m) => m.VideoLibraryPage),
      },
      {
        path: 'lobby/:id',
        loadComponent: () =>
          import('./features/lobby/waiting-room/waiting-room').then((m) => m.WaitingRoom),
      },

      // ---- Un bloc par jeu : ajouter un jeu = ajouter une entrée ici ----
      {
        path: 'jeu/doublage',
        loadChildren: () => import('./games/dub/dub.routes').then((m) => m.DUB_ROUTES),
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
