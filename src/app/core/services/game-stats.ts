import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

export interface GameStats {
  gamesPlayed: number;
  wins: number;
  bestScore: number | null;
  /** Nombre de fois où chaque trophée a été remporté, par clé (ex: 'hater'). */
  trophyCounts: Partial<Record<string, number>>;
}

export interface RecentResult {
  score: number;
  placement: number;
  playerCount: number;
  playedAt: string;
}

export interface GameProfile {
  stats: GameStats;
  /** Les parties les plus récentes en premier. */
  recent: RecentResult[];
}

/**
 * Statistiques d'un joueur pour un jeu donné, calculées à partir de
 * l'historique persistant (game_results), qui survit à la suppression
 * des parties elles-mêmes.
 */
@Injectable({
  providedIn: 'root',
})
export class GameStatsService {
  private readonly supabase = inject(SupabaseService).client;

  async getGameProfile(profileId: string, gameId: string, recentLimit = 5): Promise<GameProfile> {
    const { data, error } = await this.supabase
      .from('game_results')
      .select('score, placement, player_count, trophies, played_at')
      .eq('profile_id', profileId)
      .eq('game_id', gameId)
      .order('played_at', { ascending: false });

    if (error) throw error;
    const rows = data ?? [];

    const trophyCounts: Partial<Record<string, number>> = {};
    for (const row of rows) {
      for (const key of (row.trophies as string[]) ?? []) {
        trophyCounts[key] = (trophyCounts[key] ?? 0) + 1;
      }
    }

    const stats: GameStats = {
      gamesPlayed: rows.length,
      wins: rows.filter((r) => r.placement === 1).length,
      bestScore: rows.length > 0 ? Math.max(...rows.map((r) => r.score)) : null,
      trophyCounts,
    };

    const recent: RecentResult[] = rows.slice(0, recentLimit).map((r) => ({
      score: r.score,
      placement: r.placement,
      playerCount: r.player_count,
      playedAt: r.played_at,
    }));

    return { stats, recent };
  }
}
