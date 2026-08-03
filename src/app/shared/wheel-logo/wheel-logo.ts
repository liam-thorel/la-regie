import { Component, input } from '@angular/core';

/**
 * Logo Olygames : une grande roue dont les rayons tournent pendant que les
 * nacelles restent à l'endroit, comme une vraie roue. Chaque nacelle porte
 * une couleur de la palette.
 */
@Component({
  selector: 'app-wheel-logo',
  imports: [],
  templateUrl: './wheel-logo.html',
  styleUrl: './wheel-logo.scss',
})
export class WheelLogo {
  /** Taille du logo en pixels. */
  readonly size = input(56);
  /** Roue à l'arrêt, pour les contextes où l'animation dérange. */
  readonly still = input(false);
  /** Durée d'un tour en secondes. Plus la valeur est basse, plus la roue
   *  tourne vite : utilisé pour distinguer la marque (lente) du
   *  chargement (rapide). */
  readonly speed = input(28);
}
