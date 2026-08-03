import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WheelLogo } from '../wheel-logo/wheel-logo';
import { AppVolumeService } from '../../core/services/app-volume';

/**
 * Barre discrète présente sur les écrans de jeu : logo (renvoie à
 * l'accueil), et menu burger pour y retourner autrement, plus le réglage
 * de volume commun à tous les lecteurs audio/vidéo.
 */
@Component({
  selector: 'app-top-bar',
  imports: [RouterLink, WheelLogo],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
})
export class TopBar {
  readonly volumeService = inject(AppVolumeService);
  readonly open = signal(false);

  toggle(): void {
    this.open.set(!this.open());
  }

  close(): void {
    this.open.set(false);
  }

  onVolumeInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.volumeService.setVolume(value / 100);
  }
}
