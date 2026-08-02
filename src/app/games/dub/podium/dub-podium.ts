import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase';
import { LobbyService } from '../../../core/services/lobby';
import { Lobby } from '../../../core/models/types';

/** Une ligne de la vue lobby_trophies : score et compteurs de votes. */
interface TrophyRow {
  player_id: string;
  pseudo: string;
  avatar_url: string | null;
  score: number;
  dislikes_given: number;
  likes_given: number;
  super_likes_received: number;
}

interface Trophy {
  key: string;
  label: string;
  description: string;
  winner: TrophyRow | null;
  count: number;
}

@Component({
  selector: 'app-dub-podium',
  imports: [RouterLink],
  templateUrl: './dub-podium.html',
  styleUrl: './dub-podium.scss',
})
export class DubPodium implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SupabaseService).client;
  private readonly lobbyService = inject(LobbyService);

  readonly lobby = signal<Lobby | null>(null);
  readonly rows = signal<TrophyRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Classement complet, du meilleur au moins bon. */
  readonly ranking = computed(() => [...this.rows()].sort((a, b) => b.score - a.score));

  /** Les trois premiers, réordonnés pour l'affichage du podium : 2e, 1er, 3e. */
  readonly podium = computed(() => {
    const [first, second, third] = this.ranking();
    return [
      { place: 2, player: second ?? null },
      { place: 1, player: first ?? null },
      { place: 3, player: third ?? null },
    ].filter((step) => step.player !== null);
  });

  readonly trophies = computed<Trophy[]>(() => {
    const rows = this.rows();

    const best = (pick: (row: TrophyRow) => number): { winner: TrophyRow | null; count: number } => {
      const top = [...rows].sort((a, b) => pick(b) - pick(a))[0];
      // Pas de trophée si personne n'a jamais fait le geste concerné.
      return top && pick(top) > 0 ? { winner: top, count: pick(top) } : { winner: null, count: 0 };
    };

    const hater = best((row) => row.dislikes_given);
    const liker = best((row) => row.likes_given);
    const goat = best((row) => row.super_likes_received);

    return [
      {
        key: 'hater',
        label: 'Le Hater',
        description: 'A distribué le plus de −1',
        ...hater,
      },
      {
        key: 'liker',
        label: 'Le Liker',
        description: 'A distribué le plus de +1',
        ...liker,
      },
      {
        key: 'goat',
        label: 'Le GOAT',
        description: 'A reçu le plus de super likes',
        ...goat,
      },
    ];
  });

  async ngOnInit(): Promise<void> {
    const lobbyId = this.route.snapshot.paramMap.get('lobbyId') ?? '';

    try {
      const [lobby, { data, error }] = await Promise.all([
        this.lobbyService.getLobby(lobbyId),
        this.supabase.from('lobby_trophies').select('*').eq('lobby_id', lobbyId),
      ]);

      if (error) throw error;
      this.lobby.set(lobby);
      this.rows.set((data ?? []) as TrophyRow[]);
    } catch {
      this.error.set('Impossible de charger les résultats.');
    } finally {
      this.loading.set(false);
    }
  }
}
