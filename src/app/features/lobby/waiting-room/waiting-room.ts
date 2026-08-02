import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { LobbyService } from '../../../core/services/lobby';
import { AuthService } from '../../../core/services/auth';
import { Lobby, Player } from '../../../core/models/types';
import { GameDefinition, getGame } from '../../../core/models/game-registry';

/**
 * Salle d'attente commune à tous les jeux : code d'invitation, liste des
 * joueurs en temps réel, lancement par l'host. Le jeu concerné est déduit
 * du champ game_id du lobby, puis résolu via le registre.
 */
@Component({
  selector: 'app-waiting-room',
  imports: [],
  templateUrl: './waiting-room.html',
  styleUrl: './waiting-room.scss',
})
export class WaitingRoom implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lobbyService = inject(LobbyService);
  readonly auth = inject(AuthService);

  readonly lobby = signal<Lobby | null>(null);
  readonly game = signal<GameDefinition | null>(null);
  readonly players = signal<Player[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly starting = signal(false);
  readonly codeCopied = signal(false);

  private playersChannel: RealtimeChannel | null = null;
  private lobbyChannel: RealtimeChannel | null = null;
  private lobbyId = '';

  get isHost(): boolean {
    const profile = this.auth.currentProfile();
    return !!profile && profile.id === this.lobby()?.host_id;
  }

  get canStart(): boolean {
    const min = this.game()?.minPlayers ?? 2;
    return this.players().length >= min;
  }

  async ngOnInit(): Promise<void> {
    this.lobbyId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.lobbyId) {
      this.error.set('Lobby introuvable.');
      this.loading.set(false);
      return;
    }

    try {
      const [lobby, players] = await Promise.all([
        this.lobbyService.getLobby(this.lobbyId),
        this.lobbyService.listPlayers(this.lobbyId),
      ]);

      if (!lobby) {
        this.error.set('Ce lobby n\u2019existe pas ou plus.');
        return;
      }

      this.lobby.set(lobby);
      this.game.set(getGame(lobby.game_id) ?? null);
      this.players.set(players);

      // Partie déjà lancée (rechargement de page en cours de jeu) : on rejoint.
      if (lobby.status === 'in_game') {
        this.goToGame();
      }
    } catch {
      this.error.set('Impossible de charger le lobby.');
    } finally {
      this.loading.set(false);
    }

    this.playersChannel = this.lobbyService.subscribeToPlayers(this.lobbyId, async () => {
      this.players.set(await this.lobbyService.listPlayers(this.lobbyId));
    });

    // Quand l'host lance, tous les autres joueurs basculent automatiquement.
    this.lobbyChannel = this.lobbyService.subscribeToLobby(this.lobbyId, (updated) => {
      this.lobby.set(updated);
      if (updated.status === 'in_game') {
        this.goToGame();
      }
    });
  }

  ngOnDestroy(): void {
    this.playersChannel?.unsubscribe();
    this.lobbyChannel?.unsubscribe();
  }

  private goToGame(): void {
    const game = this.game();
    if (game) {
      this.router.navigateByUrl(game.playRoute(this.lobbyId));
    }
  }

  async copyCode(): Promise<void> {
    const code = this.lobby()?.code;
    if (!code) return;

    await navigator.clipboard.writeText(code);
    this.codeCopied.set(true);
    setTimeout(() => this.codeCopied.set(false), 2000);
  }

  async startGame(): Promise<void> {
    if (!this.isHost || !this.canStart) return;

    this.starting.set(true);
    const { error } = await this.lobbyService.startGame(this.lobbyId);
    this.starting.set(false);

    if (error) {
      this.error.set('Impossible de lancer la partie.');
    }
    // La redirection se fait via l'abonnement temps réel, pour l'host comme
    // pour les autres joueurs.
  }
}
