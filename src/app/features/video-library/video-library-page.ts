import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VideoLibraryService } from '../../core/services/video-library';
import { VideoAsset } from '../../core/models/types';
import { TopBar } from '../../shared/top-bar/top-bar';
import { LoadingOverlay } from '../../shared/loading-overlay/loading-overlay';

/** Au-delà, avertissement avant l'envoi plutôt qu'un blocage silencieux. */
const MAX_RECOMMENDED_DURATION_SECONDS = 180;
const MAX_RECOMMENDED_SIZE_MB = 200;

/**
 * Gestion de la bibliothèque de vidéos.
 * Le fichier part directement du navigateur vers Cloudflare R2 via une URL
 * signée générée par une Edge Function : la clé secrète R2 ne transite
 * jamais côté client.
 */
@Component({
  selector: 'app-video-library-page',
  imports: [LoadingOverlay, TopBar, FormsModule, RouterLink],
  templateUrl: './video-library-page.html',
  styleUrl: './video-library-page.scss',
})
export class VideoLibraryPage implements OnInit {
  private readonly library = inject(VideoLibraryService);

  readonly videos = signal<VideoAsset[]>([]);
  readonly title = signal('');
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);

  private file: File | null = null;
  readonly fileName = signal<string | null>(null);

  readonly editingId = signal<string | null>(null);
  readonly editingTitle = signal('');
  readonly generatingId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.videos.set(await this.library.listVideos());
    } catch {
      this.error.set('Impossible de charger la bibliothèque.');
    } finally {
      this.loading.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.fileName.set(this.file?.name ?? null);

    // Pré-remplit le titre avec le nom du fichier, sans son extension.
    if (this.file && !this.title()) {
      this.title.set(this.file.name.replace(/\.[^.]+$/, ''));
    }
  }

  async upload(): Promise<void> {
    if (!this.file || !this.title().trim()) {
      this.error.set('Choisis un fichier et donne-lui un titre.');
      return;
    }

    // Une prise démarre avec la vidéo et se termine avec elle : une vidéo
    // trop longue transforme une manche en marathon d'enregistrement.
    // Avertissement plutôt que blocage strict, l'host reste juge.
    const duration = await this.library.readDuration(this.file).catch(() => null);
    const sizeMB = this.file.size / (1024 * 1024);

    if (duration && duration > MAX_RECOMMENDED_DURATION_SECONDS) {
      const minutes = Math.round(duration / 60);
      const proceed = confirm(
        `Cette vidéo dure ${minutes} min. Une prise dure aussi longtemps qu'elle : ` +
          `au-delà de quelques minutes, la manche devient difficile à jouer. Continuer quand même ?`,
      );
      if (!proceed) return;
    } else if (sizeMB > MAX_RECOMMENDED_SIZE_MB) {
      const proceed = confirm(
        `Ce fichier fait ${sizeMB.toFixed(0)} Mo. C'est volumineux : l'envoi prendra du temps ` +
          `et ça mangera une bonne partie de l'espace R2 gratuit. Continuer quand même ?`,
      );
      if (!proceed) return;
    }

    this.error.set(null);
    this.uploading.set(true);
    this.progress.set(0);

    const { error } = await this.library.uploadVideo(this.file, this.title().trim(), (percent) =>
      this.progress.set(percent),
    );

    this.uploading.set(false);

    if (error) {
      this.error.set(error);
      return;
    }

    this.file = null;
    this.fileName.set(null);
    this.title.set('');
    await this.refresh();
  }

  thumbnailUrl(key: string | null): string | null {
    return this.library.thumbnailUrl(key);
  }

  startRename(video: VideoAsset): void {
    this.error.set(null);
    this.editingId.set(video.id);
    this.editingTitle.set(video.title);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  async saveRename(video: VideoAsset): Promise<void> {
    const title = this.editingTitle().trim();
    if (!title) {
      this.error.set('Le titre ne peut pas être vide.');
      return;
    }

    const { error } = await this.library.renameVideo(video.id, title);
    if (error) {
      this.error.set(error);
      return;
    }

    this.editingId.set(null);
    await this.refresh();
  }

  async generateThumbnail(video: VideoAsset): Promise<void> {
    this.error.set(null);
    this.generatingId.set(video.id);

    const { error } = await this.library.backfillThumbnail(video);
    this.generatingId.set(null);

    if (error) {
      this.error.set(error);
      return;
    }
    await this.refresh();
  }

  async remove(video: VideoAsset): Promise<void> {
    const { error } = await this.library.deleteVideo(video);
    if (error) {
      this.error.set(error);
      return;
    }
    await this.refresh();
  }
}
