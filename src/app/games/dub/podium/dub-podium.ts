import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../../core/services/supabase';
import { LobbyService } from '../../../core/services/lobby';
import { AuthService } from '../../../core/services/auth';
import { DubGameService } from '../services/dub-game';
import { DubSettings, Lobby } from '../../../core/models/types';
import { LoadingOverlay } from '../../../shared/loading-overlay/loading-overlay';

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
  imports: [LoadingOverlay, RouterLink],
  templateUrl: './dub-podium.html',
  styleUrl: './dub-podium.scss',
})
export class DubPodium implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SupabaseService).client;
  private readonly lobbyService = inject(LobbyService);
  private readonly dubGame = inject(DubGameService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly lobby = signal<Lobby | null>(null);
  readonly rows = signal<TrophyRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly closing = signal(false);
  readonly rematching = signal(false);
  /** Code annoncé par l'host quand il relance une partie, pour que les
   *  autres joueurs encore sur cet écran puissent rejoindre en un clic. */
  readonly rematchCode = signal<string | null>(null);

  private rematchChannel: RealtimeChannel | null = null;
  private lobbyId = '';

  /** Confettis du podium : position, couleur, délai et durée tirés au sort. */
  readonly confetti = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    color: `var(${['--c-red', '--c-gold', '--c-teal', '--c-green', '--c-blurple', '--c-pink'][i % 6]})`,
    delay: Math.random() * 0.8,
    duration: 2.8 + Math.random() * 1.6,
    drift: Math.random() * 50 - 25,
    tilt: Math.random() * 360,
  }));

  get isHost(): boolean {
    const profile = this.auth.currentProfile();
    return !!profile && profile.id === this.lobby()?.host_id;
  }

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
    this.lobbyId = this.route.snapshot.paramMap.get('lobbyId') ?? '';

    try {
      const [lobby, { data, error }] = await Promise.all([
        this.lobbyService.getLobby(this.lobbyId),
        this.supabase.from('lobby_trophies').select('*').eq('lobby_id', this.lobbyId),
      ]);

      if (error) throw error;
      this.lobby.set(lobby);
      this.rows.set((data ?? []) as TrophyRow[]);
    } catch {
      this.error.set('Impossible de charger les résultats.');
    } finally {
      this.loading.set(false);
    }

    // Si l'host relance une partie pendant qu'on est encore sur cet écran,
    // on reçoit directement le code plutôt que d'attendre qu'on nous le
    // dise à l'oral.
    this.rematchChannel = this.dubGame.rematchChannel(this.lobbyId, (code) => {
      this.rematchCode.set(code);
    });
  }

  ngOnDestroy(): void {
    this.rematchChannel?.unsubscribe();
  }

  /**
   * Réservé à l'host : crée une nouvelle partie avec les mêmes vidéos et
   * le même nombre de manches, puis prévient les autres joueurs encore
   * présents pour qu'ils puissent la rejoindre en un clic.
   */
  async rematch(): Promise<void> {
    const lobby = this.lobby();
    if (!this.isHost || !lobby) return;

    this.error.set(null);
    this.rematching.set(true);

    const settings = lobby.settings as unknown as DubSettings;
    const { lobby: newLobby, error } = await this.lobbyService.createLobby(
      'doublage',
      lobby.rounds_count,
      lobby.settings,
    );

    if (error || !newLobby) {
      this.rematching.set(false);
      this.error.set('Impossible de relancer une partie.');
      return;
    }

    if (settings?.videoIds?.length) {
      await this.dubGame.setupRounds(newLobby.id, settings.videoIds);
    }

    if (this.rematchChannel) {
      await this.dubGame.announceRematch(this.rematchChannel, newLobby.code);
    }

    this.rematching.set(false);
    this.router.navigate(['/lobby', newLobby.id]);
  }

  /**
   * Réservé à l'host : supprime définitivement la partie une fois que tout
   * le monde a vu les résultats. Les fichiers audio partent d'abord, car
   * la suppression du lobby fait perdre le droit d'y toucher.
   */
  async closeGame(): Promise<void> {
    const lobby = this.lobby();
    if (!this.isHost || !lobby) return;

    this.closing.set(true);
    await this.dubGame.deleteLobbyAudio(lobby.id);
    const { error } = await this.lobbyService.deleteLobby(lobby.id);
    this.closing.set(false);

    if (error) {
      this.error.set('La partie n\u2019a pas pu être supprimée.');
      return;
    }
    this.router.navigateByUrl('/');
  }
}
