import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KeyValuePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { GameStats, GameStatsService, RecentResult } from '../../core/services/game-stats';
import { GAMES } from '../../core/models/game-registry';
import { TopBar } from '../../shared/top-bar/top-bar';
import { LoadingOverlay } from '../../shared/loading-overlay/loading-overlay';

interface GameStatsRow {
  gameId: string;
  gameName: string;
  trophyLabels: Record<string, string>;
  stats: GameStats;
  recent: RecentResult[];
}

@Component({
  selector: 'app-profile-page',
  imports: [FormsModule, KeyValuePipe, RouterLink, TopBar, LoadingOverlay],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.scss',
})
export class ProfilePage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly gameStats = inject(GameStatsService);

  readonly pseudo = signal('');
  readonly avatarPreview = signal<string | null>(null);
  private avatarFile: File | null = null;

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  readonly loadingStats = signal(true);
  readonly gameStatsRows = signal<GameStatsRow[]>([]);

  async ngOnInit(): Promise<void> {
    const profile = this.auth.currentProfile();
    if (profile) {
      this.pseudo.set(profile.pseudo);
      this.avatarPreview.set(profile.avatar_url);
    }

    await this.loadStats();
  }

  private async loadStats(): Promise<void> {
    const profile = this.auth.currentProfile();
    if (!profile) {
      this.loadingStats.set(false);
      return;
    }

    try {
      const rows = await Promise.all(
        GAMES.map(async (game): Promise<GameStatsRow> => {
          const { stats, recent } = await this.gameStats.getGameProfile(profile.id, game.id);
          return {
            gameId: game.id,
            gameName: game.name,
            trophyLabels: game.trophies ?? {},
            stats,
            recent,
          };
        }),
      );
      this.gameStatsRows.set(rows);
    } catch {
      // Les stats ne chargent pas : pas bloquant pour le reste de la page.
    } finally {
      this.loadingStats.set(false);
    }
  }

  ordinal(place: number): string {
    return place === 1 ? '1er' : `${place}e`;
  }

  formatShortDate(iso: string): string {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));
  }

  formatMemberSince(iso: string): string {
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(iso));
  }

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.avatarFile = file;
    if (file) this.avatarPreview.set(URL.createObjectURL(file));
  }

  async save(): Promise<void> {
    this.error.set(null);
    this.saved.set(false);

    if (this.pseudo().trim().length < 2) {
      this.error.set('Choisis un pseudo d\u2019au moins 2 caractères.');
      return;
    }

    this.saving.set(true);
    const { error } = await this.auth.updateProfile(this.pseudo().trim(), this.avatarFile);
    this.saving.set(false);

    if (error) {
      this.error.set(error);
      return;
    }

    this.avatarFile = null;
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2500);
  }
}
