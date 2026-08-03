import { Component, input } from '@angular/core';
import { WheelLogo } from '../wheel-logo/wheel-logo';

/**
 * Recouvrement de chargement : léger grisement de l'écran, roue au premier
 * plan qui tourne vite pour signaler l'attente (à distinguer de la roue
 * lente utilisée comme marque ailleurs dans l'interface).
 */
@Component({
  selector: 'app-loading-overlay',
  imports: [WheelLogo],
  templateUrl: './loading-overlay.html',
  styleUrl: './loading-overlay.scss',
})
export class LoadingOverlay {
  readonly label = input('Chargement...');
}
