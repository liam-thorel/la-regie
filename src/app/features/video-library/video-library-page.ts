import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VideoLibraryService } from '../../core/services/video-library';
import { VideoAsset } from '../../core/models/types';

/**
 * Gestion de la bibliothèque de vidéos.
 * Le fichier part directement du navigateur vers Cloudflare R2 via une URL
 * signée générée par une Edge Function : la clé secrète R2 ne transite
 * jamais côté client.
 */
@Component({
  selector: 'app-video-library-page',
  imports: [FormsModule, RouterLink],
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

  async remove(video: VideoAsset): Promise<void> {
    const { error } = await this.library.deleteVideo(video);
    if (error) {
      this.error.set(error);
      return;
    }
    await this.refresh();
  }
}
