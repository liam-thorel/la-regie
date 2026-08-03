import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { LobbyService } from '../../../core/services/lobby';
import { AuthService } from '../../../core/services/auth';
import { VideoLibraryService } from '../../../core/services/video-library';
import { DubGameService, DubWithPlayer, VoteWithVoter } from '../services/dub-game';
import { SoundService } from '../../../core/services/sound';
import { AppVolumeService } from '../../../core/services/app-volume';
import { Lobby, Player, VideoAsset } from '../../../core/models/types';
import { Scoreboard } from '../../../shared/scoreboard/scoreboard';
import { TopBar } from '../../../shared/top-bar/top-bar';
import { LoadingOverlay } from '../../../shared/loading-overlay/loading-overlay';

type VoteValue = -1 | 0 | 1 | 2;

/**
 * Vote : un tableau avec une ligne par doublage. Chacun peut revoir un
 * doublage autant qu'il veut avant de trancher. Les votes sont publics et
 * s'affichent en direct. Le super like vaut 2 points, une seule fois par manche.
 */
@Component({
  selector: 'app-dub-voting',
  imports: [LoadingOverlay, TopBar, Scoreboard],
  templateUrl: './dub-voting.html',
  styleUrl: './dub-voting.scss',
})
export class DubVoting implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lobbyService = inject(LobbyService);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly dubGame = inject(DubGameService);
  readonly auth = inject(AuthService);
  readonly volumeService = inject(AppVolumeService);
  private readonly sound = inject(SoundService);

  readonly lobby = signal<Lobby | null>(null);
  readonly players = signal<Player[]>([]);
  readonly myPlayer = signal<Player | null>(null);
  readonly video = signal<VideoAsset | null>(null);
  readonly dubs = signal<DubWithPlayer[]>([]);
  readonly votes = signal<VoteWithVoter[]>([]);
  readonly replayingDubId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private channels: RealtimeChannel[] = [];
  private lobbyId = '';

  readonly roundNumber = computed(() => this.lobby()?.current_round ?? 1);

  /** Doublages sur lesquels ce joueur doit voter (tous sauf le sien). */
  readonly votableDubs = computed(() => {
    const me = this.myPlayer();
    return this.dubs().filter((dub) => dub.player_id !== me?.id);
  });

  readonly myVotes = computed(() => {
    const me = this.myPlayer();
    return this.votes().filter((vote) => vote.voter_player_id === me?.id);
  });

  readonly superLikeUsed = computed(() => this.myVotes().some((vote) => vote.value === 2));

  readonly iHaveFinished = computed(
    () => this.votableDubs().length > 0 && this.myVotes().length >= this.votableDubs().length,
  );

  /** Nombre de joueurs ayant fini de voter, pour le compteur partagé. */
  readonly finishedVoterIds = computed(() => {
    const dubsById = new Map(this.dubs().map((dub) => [dub.id, dub.player_id]));
    return this.players()
      .filter((player) => {
        const toVote = this.dubs().filter((dub) => dub.player_id !== player.id).length;
        const cast = this.votes().filter(
          (vote) => vote.voter_player_id === player.id && dubsById.has(vote.dub_id),
        ).length;
        return toVote > 0 && cast >= toVote;
      })
      .map((player) => player.id);
  });

  readonly everyoneVoted = computed(
    () => this.players().length > 0 && this.finishedVoterIds().length >= this.players().length,
  );

  readonly isLastRound = computed(() => {
    const lobby = this.lobby();
    return !!lobby && lobby.current_round >= lobby.rounds_count;
  });

  get isHost(): boolean {
    const profile = this.auth.currentProfile();
    return !!profile && profile.id === this.lobby()?.host_id;
  }

  async ngOnInit(): Promise<void> {
    this.lobbyId = this.route.snapshot.paramMap.get('lobbyId') ?? '';

    try {
      const [lobby, players, myPlayer, phase] = await Promise.all([
        this.lobbyService.getLobby(this.lobbyId),
        this.lobbyService.listPlayers(this.lobbyId),
        this.lobbyService.getMyPlayer(this.lobbyId),
        this.dubGame.getPhase(this.lobbyId),
      ]);

      if (!lobby) {
        this.error.set('Partie introuvable.');
        return;
      }

      // Reprise après rechargement : la partie a pu avancer pendant notre
      // absence (manche suivante, voire partie terminée).
      const screen = this.dubGame.resolveScreen(lobby, phase?.phase ?? null);
      if (screen !== 'vote') {
        this.router.navigate(['/jeu/doublage', this.lobbyId, screen]);
        return;
      }

      this.lobby.set(lobby);
      this.players.set(players);
      this.myPlayer.set(myPlayer);

      const [video, dubs, votes] = await Promise.all([
        this.dubGame.getRoundVideo(this.lobbyId, lobby.current_round),
        this.dubGame.listDubs(this.lobbyId, lobby.current_round),
        this.dubGame.listVotes(this.lobbyId, lobby.current_round),
      ]);

      this.video.set(video);
      this.dubs.set(dubs);
      this.votes.set(votes);

      this.sound.playPing();
    } catch {
      this.error.set('Impossible de charger les votes.');
    } finally {
      this.loading.set(false);
    }

    this.channels.push(
      this.lobbyService.subscribeToPlayers(this.lobbyId, async () => {
        this.players.set(await this.lobbyService.listPlayers(this.lobbyId));
      }),
      // Les votes tombent en direct chez tout le monde.
      this.dubGame.subscribeToVotes(this.lobbyId, async () => {
        this.votes.set(await this.dubGame.listVotes(this.lobbyId, this.roundNumber()));
      }),
      // Fin de manche : nouvelle manche ou podium.
      this.lobbyService.subscribeToLobby(this.lobbyId, (updated) => {
        if (updated.status === 'finished') {
          this.router.navigate(['/jeu/doublage', this.lobbyId, 'podium']);
          return;
        }
        if (updated.current_round !== this.roundNumber()) {
          this.router.navigate(['/jeu/doublage', this.lobbyId, 'manche']);
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this.channels.forEach((channel) => channel.unsubscribe());
  }

  videoUrl(): string {
    const video = this.video();
    return video ? this.videoLibrary.publicUrl(video.storage_key) : '';
  }

  audioUrl(dub: DubWithPlayer): string {
    return this.dubGame.audioUrl(dub.audio_storage_path);
  }

  votesFor(dubId: string): VoteWithVoter[] {
    return this.votes().filter((vote) => vote.dub_id === dubId);
  }

  myVoteFor(dubId: string): VoteValue | null {
    const vote = this.myVotes().find((v) => v.dub_id === dubId);
    return vote ? (vote.value as VoteValue) : null;
  }

  /** Total des points reçus par un doublage sur cette manche. */
  totalFor(dubId: string): number {
    return this.votesFor(dubId).reduce((sum, vote) => sum + vote.value, 0);
  }

  toggleReplay(dubId: string): void {
    this.replayingDubId.set(this.replayingDubId() === dubId ? null : dubId);
  }

  async vote(dub: DubWithPlayer, value: VoteValue): Promise<void> {
    const me = this.myPlayer();
    if (!me) return;

    if (value === 2 && this.superLikeUsed() && this.myVoteFor(dub.id) !== 2) {
      this.error.set('Tu as déjà utilisé ton super like sur cette manche.');
      return;
    }

    this.error.set(null);
    const { error } = await this.dubGame.castVote(
      this.lobbyId,
      this.roundNumber(),
      dub.id,
      me.id,
      value,
    );

    if (error) {
      this.error.set(error);
      return;
    }
    this.votes.set(await this.dubGame.listVotes(this.lobbyId, this.roundNumber()));
  }

  /**
   * Réservé à l'host : clôt la manche. Les joueurs qui n'ont pas voté sont
   * simplement comptés comme des votes à 0, donc sans effet sur les scores.
   */
  async endRound(): Promise<void> {
    const lobby = this.lobby();
    if (!this.isHost || !lobby) return;

    await this.dubGame.endRound(this.lobbyId, lobby.current_round, lobby.rounds_count);
  }
}
