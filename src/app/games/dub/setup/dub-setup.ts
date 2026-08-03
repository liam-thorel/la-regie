import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { VideoLibraryService } from '../../../core/services/video-library';
import { LobbyService } from '../../../core/services/lobby';
import { DubGameService } from '../services/dub-game';
import { VideoAsset, DubSettings } from '../../../core/models/types';
import { TopBar } from '../../../shared/top-bar/top-bar';
import { LoadingOverlay } from '../../../shared/loading-overlay/loading-overlay';

type PickMode = 'random' | 'manual';

@Component({
  selector: 'app-dub-setup',
  imports: [LoadingOverlay, TopBar, FormsModule],
  templateUrl: './dub-setup.html',
  styleUrl: './dub-setup.scss',
})
export class DubSetup implements OnInit {
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly lobbyService = inject(LobbyService);
  private readonly dubGame = inject(DubGameService);
  private readonly router = inject(Router);

  readonly videos = signal<VideoAsset[]>([]);
  readonly roundsCount = signal(3);
  readonly mode = signal<PickMode>('random');
  readonly selectedVideoIds = signal<string[]>([]);
  readonly loading = signal(false);
  readonly loadingVideos = signal(true);
  readonly error = signal<string | null>(null);

  thumbnailUrl(key: string | null): string | null {
    return this.videoLibrary.thumbnailUrl(key);
  }

  /** On ne peut pas jouer plus de manches qu'il n'y a de vidéos. */
  readonly maxRounds = computed(() => Math.max(1, this.videos().length));

  readonly remainingToPick = computed(() =>
    Math.max(0, this.roundsCount() - this.selectedVideoIds().length),
  );

  readonly canSubmit = computed(() => {
    if (this.videos().length === 0) return false;
    if (this.mode() === 'random') return this.roundsCount() <= this.videos().length;
    return this.selectedVideoIds().length === this.roundsCount();
  });

  async ngOnInit(): Promise<void> {
    try {
      const videos = await this.videoLibrary.listVideos();
      this.videos.set(videos);
      if (videos.length > 0 && this.roundsCount() > videos.length) {
        this.roundsCount.set(videos.length);
      }
    } catch {
      this.error.set('Impossible de charger la bibliothèque de vidéos.');
    } finally {
      this.loadingVideos.set(false);
    }
  }

  setMode(mode: PickMode): void {
    this.mode.set(mode);
    this.error.set(null);
    if (mode === 'random') {
      this.selectedVideoIds.set([]);
    }
  }

  setRounds(value: number): void {
    const clamped = Math.min(Math.max(1, Math.round(value || 1)), this.maxRounds());
    this.roundsCount.set(clamped);

    // Si l'host réduit le nombre de manches après avoir choisi ses vidéos,
    // on garde les premières sélectionnées et on jette le surplus.
    if (this.selectedVideoIds().length > clamped) {
      this.selectedVideoIds.set(this.selectedVideoIds().slice(0, clamped));
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

    if (current.includes(id)) {
      this.selectedVideoIds.set(current.filter((v) => v !== id));
      return;
    }

    if (current.length >= this.roundsCount()) {
      this.error.set(`Tu as déjà choisi tes ${this.roundsCount()} vidéos.`);
      return;
    }

    this.error.set(null);
    this.selectedVideoIds.set([...current, id]);
  }

  /** Tirage sans remise dans la bibliothèque. */
  private drawRandomVideoIds(count: number): string[] {
    const pool = this.videos().map((video) => video.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  async submit(): Promise<void> {
    this.error.set(null);

    if (this.videos().length === 0) {
      this.error.set('La bibliothèque est vide : ajoute des vidéos avant de créer un lobby.');
      return;
    }

    if (this.mode() === 'manual' && this.selectedVideoIds().length !== this.roundsCount()) {
      this.error.set(`Choisis exactement ${this.roundsCount()} vidéo(s).`);
      return;
    }

    const videoIds =
      this.mode() === 'random'
        ? this.drawRandomVideoIds(this.roundsCount())
        : this.selectedVideoIds();

    const settings: DubSettings = { videoIds };

    this.loading.set(true);
    const { lobby, error } = await this.lobbyService.createLobby(
      'doublage',
      videoIds.length,
      settings as unknown as Record<string, unknown>,
    );

    if (error || !lobby) {
      this.loading.set(false);
      this.error.set(error ?? 'Création du lobby impossible.');
      return;
    }

    // Associe une vidéo à chaque manche : sans ces lignes, la partie
    // démarre sans rien à doubler.
    const { error: roundsError } = await this.dubGame.setupRounds(lobby.id, videoIds);
    this.loading.set(false);

    if (roundsError) {
      this.error.set('Les manches n\u2019ont pas pu être créées.');
      return;
    }

    this.router.navigate(['/lobby', lobby.id]);
  }
}
