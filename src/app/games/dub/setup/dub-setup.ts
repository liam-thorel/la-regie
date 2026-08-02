import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { VideoLibraryService } from '../../../core/services/video-library';
import { LobbyService } from '../../../core/services/lobby';
import { DubGameService } from '../services/dub-game';
import { VideoAsset, DubSettings } from '../../../core/models/types';

@Component({
  selector: 'app-dub-setup',
  imports: [FormsModule],
  templateUrl: './dub-setup.html',
  styleUrl: './dub-setup.scss',
})
export class DubSetup implements OnInit {
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly lobbyService = inject(LobbyService);
  private readonly dubGame = inject(DubGameService);
  private readonly router = inject(Router);

  readonly videos = signal<VideoAsset[]>([]);
  readonly selectedVideoIds = signal<string[]>([]);
  readonly loading = signal(false);
  readonly loadingVideos = signal(true);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.videos.set(await this.videoLibrary.listVideos());
    } catch {
      this.error.set('Impossible de charger la bibliothèque de vidéos.');
    } finally {
      this.loadingVideos.set(false);
    }
  }

  isSelected(id: string): boolean {
    return this.selectedVideoIds().includes(id);
  }

  /** Le rang (1, 2, 3...) de la vidéo dans l'ordre des manches, si sélectionnée. */
  roundNumber(id: string): number {
    return this.selectedVideoIds().indexOf(id) + 1;
  }

  toggleVideo(id: string): void {
    const current = this.selectedVideoIds();
    this.selectedVideoIds.set(
      current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    );
  }

  async submit(): Promise<void> {
    this.error.set(null);

    if (this.selectedVideoIds().length < 1) {
      this.error.set('Choisis au moins une vidéo : chaque vidéo = une manche.');
      return;
    }

    const settings: DubSettings = {
      videoIds: this.selectedVideoIds(),
    };

    this.loading.set(true);
    const { lobby, error } = await this.lobbyService.createLobby(
      'doublage',
      this.selectedVideoIds().length,
      settings as unknown as Record<string, unknown>,
    );
    this.loading.set(false);

    if (error || !lobby) {
      this.error.set(error ?? 'Création du lobby impossible.');
      return;
    }

    // Associe une vidéo à chaque manche : sans ces lignes, la partie
    // démarre sans rien à doubler.
    const { error: roundsError } = await this.dubGame.setupRounds(
      lobby.id,
      this.selectedVideoIds(),
    );

    if (roundsError) {
      this.error.set('Les manches n\u2019ont pas pu être créées.');
      return;
    }

    this.router.navigate(['/lobby', lobby.id]);
  }
}
