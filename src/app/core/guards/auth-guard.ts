import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services/auth';

/**
 * Bloque l'accès aux routes du jeu tant qu'aucun compte n'est connecté
 * (le compte est obligatoire pour jouer). Attend que la session initiale
 * ait fini d'être vérifiée avant de trancher, pour éviter un redirect
 * intempestif vers /login au rechargement de la page.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.ready).pipe(
    filter((ready) => ready),
    take(1),
    map(() => (auth.currentProfile() ? true : router.parseUrl('/login'))),
  );
};
