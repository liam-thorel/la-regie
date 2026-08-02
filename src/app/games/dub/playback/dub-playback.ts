import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { LobbyService } from '../../../core/services/lobby';
import { AuthService } from '../../../core/services/auth';
import { VideoLibraryService } from '../../../core/services/video-library';
import { DubGameService, DubWithPlayer } from '../services/dub-game';
import { Lobby, Player, VideoAsset } from '../../../core/models/types';
import { Scoreboard } from '../../../shared/scoreboard/scoreboard';

/**
 * Diffusion : les doublages passent un par un, en même temps chez tous les
 * joueurs. La vidéo est toujours muette ici, seul le doublage s'entend.
 * L'host fait avancer la diffusion, l'index est répliqué en temps réel.
 */
@Component({
  selector: 'app-dub-playback',
  imports: [Scoreboard],
  templateUrl: './dub-playback.html',
  styleUrl: './dub-playback.scss',
})
export class DubPlayback implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lobbyService = inject(LobbyService);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly dubGame = inject(DubGameService);
  readonly auth = inject(AuthService);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
  private readonly audioRef = viewChild<ElementRef<HTMLAudioElement>>('audioEl');

  readonly lobby = signal<Lobby | null>(null);
  readonly players = signal<Player[]>([]);
  readonly myPlayer = signal<Player | null>(null);
  readonly video = signal<VideoAsset | null>(null);
  readonly dubs = signal<DubWithPlayer[]>([]);
  readonly index = signal(0);
  readonly playing = signal(false);
  /** Vrai si le navigateur a refusé de démarrer tout seul. */
  readonly needsManualStart = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private channels: RealtimeChannel[] = [];
  private commandChannel: RealtimeChannel | null = null;
  private lobbyId = '';

  readonly roundNumber = computed(() => this.lobby()?.current_round ?? 1);
  readonly currentDub = computed(() => this.dubs()[this.index()] ?? null);
  readonly isLast = computed(() => this.index() >= this.dubs().length - 1);

  get isHost(): boolean {
    const profile = this.auth.currentProfile();
    return !!profile && profile.id === this.lobby()?.host_id;
  }

  async ngOnInit(): Promise<void> {
    this.lobbyId = this.route.snapshot.paramMap.get('lobbyId') ?? '';

    try {
      const [lobby, players, myPlayer] = await Promise.all([
        this.lobbyService.getLobby(this.lobbyId),
        this.lobbyService.listPlayers(this.lobbyId),
        this.lobbyService.getMyPlayer(this.lobbyId),
      ]);

      if (!lobby) {
        this.error.set('Partie introuvable.');
        return;
      }

      this.lobby.set(lobby);
      this.players.set(players);
      this.myPlayer.set(myPlayer);

      const [video, dubs, phase] = await Promise.all([
        this.dubGame.getRoundVideo(this.lobbyId, lobby.current_round),
        this.dubGame.listDubs(this.lobbyId, lobby.current_round),
        this.dubGame.getPhase(this.lobbyId),
      ]);

      this.video.set(video);
      this.dubs.set(dubs);
      this.index.set(phase?.playback_index ?? 0);
    } catch {
      this.error.set('Impossible de charger la diffusion.');
    } finally {
      this.loading.set(false);
    }

    // L'host commande la lecture : tout le monde démarre en même temps.
    this.commandChannel = this.dubGame.playbackChannel(this.lobbyId, () => {
      void this.playCurrent();
    });

    this.channels.push(
      this.commandChannel,
      this.lobbyService.subscribeToPlayers(this.lobbyId, async () => {
        this.players.set(await this.lobbyService.listPlayers(this.lobbyId));
      }),
      this.dubGame.subscribeToPhase(this.lobbyId, (phase, playbackIndex) => {
        if (phase === 'voting') {
          this.router.navigate(['/jeu/doublage', this.lobbyId, 'vote']);
          return;
        }
        if (phase === 'playback' && playbackIndex !== this.index()) {
          this.index.set(playbackIndex);
          this.playing.set(false);
          this.needsManualStart.set(false);
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

  audioUrl(): string {
    const dub = this.currentDub();
    return dub ? this.dubGame.audioUrl(dub.audio_storage_path) : '';
  }

  /**
   * Joue la vidéo et le doublage ensemble, depuis le début.
   * La vidéo est forcée en muet : on n'entend jamais le son original,
   * seulement le doublage du joueur.
   */
  async playCurrent(): Promise<void> {
    const video = this.videoRef()?.nativeElement;
    const audio = this.audioRef()?.nativeElement;
    if (!video || !audio) return;

    video.muted = true;
    video.currentTime = 0;
    audio.currentTime = 0;
    this.playing.set(true);
    this.needsManualStart.set(false);

    try {
      await Promise.all([video.play(), audio.play()]);
    } catch {
      // Certains navigateurs refusent de démarrer le son sans un clic
      // préalable sur la page : on propose alors un bouton.
      this.playing.set(false);
      this.needsManualStart.set(true);
    }
  }

  /** Host : lance la lecture chez tous les joueurs en même temps. */
  async playForEveryone(): Promise<void> {
    if (!this.isHost || !this.commandChannel) return;
    await this.dubGame.broadcastPlay(this.commandChannel);
    await this.playCurrent();
  }

  onDubEnded(): void {
    this.playing.set(false);
    this.videoRef()?.nativeElement.pause();
  }

  /** Host : passe au doublage suivant, répliqué chez tous les joueurs. */
  async next(): Promise<void> {
    if (!this.isHost) return;

    if (this.isLast()) {
      await this.dubGame.openVoting(this.lobbyId);
      return;
    }
    this.playing.set(false);
    this.needsManualStart.set(false);
    await this.dubGame.setPlaybackIndex(this.lobbyId, this.index() + 1);
  }
}
