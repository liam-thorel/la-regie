import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services/auth';

/**
 * Réserve la gestion de la bibliothèque de vidéos aux administrateurs.
 * Ce garde ne fait que masquer l'écran : la vraie protection est côté
 * base (table admins + RLS) et dans l'Edge Function d'upload.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.ready).pipe(
    filter((ready) => ready),
    take(1),
    map(() => (auth.isAdmin() ? true : router.parseUrl('/'))),
  );
};
