import { Component, inject, signal } from '@angular/core';
import {
  Router,
  RouterOutlet,
  NavigationStart,
  NavigationEnd,
  NavigationCancel,
  NavigationError,
} from '@angular/router';
import { environment } from '../environments/environment';
import { LoadingOverlay } from './shared/loading-overlay/loading-overlay';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoadingOverlay],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);

  /**
   * Repère l'oubli le plus fréquent en configuration : les valeurs
   * d'exemple laissées telles quelles dans environment.ts. Sans ce
   * contrôle, l'erreur qui remonte au premier essai de connexion est un
   * cryptique "Failed to fetch" qui ne dit pas où chercher.
   */
  readonly misconfigured =
    environment.supabaseUrl.includes('VOTRE-PROJET') ||
    environment.supabaseAnonKey.includes('VOTRE_CLE');

  /** Vrai pendant qu'un changement de page est en cours (dont le
   *  téléchargement du code de l'écran de destination, chargé à la
   *  demande). Couvre les chargements de navigation en plus de ceux,
   *  propres à chaque écran, qui affichent leur propre recouvrement. */
  readonly navigating = signal(false);

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.navigating.set(true);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.navigating.set(false);
      }
    });
  }
}
