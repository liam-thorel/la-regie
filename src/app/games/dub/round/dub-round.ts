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
import { RecordingService } from '../services/recording';
import { Lobby, Player, VideoAsset } from '../../../core/models/types';
import { Scoreboard } from '../../../shared/scoreboard/scoreboard';

@Component({
  selector: 'app-dub-round',
  imports: [Scoreboard],
  templateUrl: './dub-round.html',
  styleUrl: './dub-round.scss',
})
export class DubRound implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lobbyService = inject(LobbyService);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly dubGame = inject(DubGameService);
  readonly recorder = inject(RecordingService);
  readonly auth = inject(AuthService);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');

  readonly lobby = signal<Lobby | null>(null);
  readonly players = signal<Player[]>([]);
  readonly myPlayer = signal<Player | null>(null);
  readonly video = signal<VideoAsset | null>(null);
  readonly dubs = signal<DubWithPlayer[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  /** Prise en cours de relecture avant validation. */
  readonly lastTakeUrl = signal<string | null>(null);
  readonly muted = signal(false);

  private channels: RealtimeChannel[] = [];
  private lobbyId = '';

  readonly roundNumber = computed(() => this.lobby()?.current_round ?? 1);

  /** Joueurs ayant figé leur prise : la manche peut avancer quand tous y sont. */
  readonly lockedPlayerIds = computed(() =>
    this.dubs()
      .filter((dub) => dub.is_locked)
      .map((dub) => dub.player_id),
  );

  readonly myDub = computed(() => {
    const me = this.myPlayer();
    return me ? (this.dubs().find((dub) => dub.player_id === me.id) ?? null) : null;
  });

  readonly hasValidated = computed(() => this.myDub()?.is_locked === true);

  readonly allValidated = computed(
    () => this.players().length > 0 && this.lockedPlayerIds().length >= this.players().length,
  );

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

      const [video, dubs] = await Promise.all([
        this.dubGame.getRoundVideo(this.lobbyId, lobby.current_round),
        this.dubGame.listDubs(this.lobbyId, lobby.current_round),
      ]);
      this.video.set(video);
      this.dubs.set(dubs);

      if (this.isHost) {
        await this.dubGame.openRecording(this.lobbyId);
      }
    } catch {
      this.error.set('Impossible de charger la manche.');
    } finally {
      this.loading.set(false);
    }

    this.channels.push(
      this.lobbyService.subscribeToPlayers(this.lobbyId, async () => {
        this.players.set(await this.lobbyService.listPlayers(this.lobbyId));
      }),
      this.dubGame.subscribeToDubs(this.lobbyId, async () => {
        this.dubs.set(await this.dubGame.listDubs(this.lobbyId, this.roundNumber()));
      }),
      // Quand l'host coupe l'enregistrement, tout le monde bascule en diffusion.
      this.dubGame.subscribeToPhase(this.lobbyId, (phase) => {
        if (phase === 'playback') {
          this.router.navigate(['/jeu/doublage', this.lobbyId, 'diffusion']);
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this.channels.forEach((channel) => channel.unsubscribe());
    if (this.recorder.isRecording()) {
      void this.recorder.stop();
    }
  }

  videoUrl(): string {
    const video = this.video();
    return video ? this.videoLibrary.publicUrl(video.storage_key) : '';
  }

  toggleMute(): void {
    const el = this.videoRef()?.nativeElement;
    if (!el) return;
    el.muted = !el.muted;
    this.muted.set(el.muted);
  }

  /**
   * Lance une prise : la vidéo repart du début et le micro tourne jusqu'à
   * la fin de la vidéo, pour que le doublage reste calé sur l'image.
   */
  async startTake(): Promise<void> {
    const el = this.videoRef()?.nativeElement;
    if (!el || this.hasValidated()) return;

    this.error.set(null);
    this.lastTakeUrl.set(null);

    const { error } = await this.recorder.start();
    if (error) {
      this.error.set(error);
      return;
    }

    el.currentTime = 0;
    await el.play();
  }

  /** Appelé quand la vidéo se termine : la prise s'arrête d'elle-même. */
  async onVideoEnded(): Promise<void> {
    if (!this.recorder.isRecording()) return;
    await this.finishTake();
  }

  /** Coupe la prise en cours avant la fin de la vidéo. */
  async stopTake(): Promise<void> {
    const el = this.videoRef()?.nativeElement;
    el?.pause();
    await this.finishTake();
  }

  private async finishTake(): Promise<void> {
    const audio = await this.recorder.stop();
    const me = this.myPlayer();
    const profile = this.auth.currentProfile();
    if (!audio || !me || !profile) return;

    this.lastTakeUrl.set(URL.createObjectURL(audio));

    this.saving.set(true);
    const { error } = await this.dubGame.saveTake(
      this.lobbyId,
      this.roundNumber(),
      me.id,
      profile.id,
      audio,
    );
    this.saving.set(false);

    if (error) this.error.set(error);
  }

  /** Fige la prise : plus de retour en arrière, le joueur est prêt. */
  async validateTake(): Promise<void> {
    const me = this.myPlayer();
    if (!me || !this.myDub()) return;

    const { error } = await this.dubGame.lockTake(this.lobbyId, this.roundNumber(), me.id);
    if (error) {
      this.error.set('Ta validation n\u2019a pas pu être enregistrée.');
      return;
    }
    this.dubs.set(await this.dubGame.listDubs(this.lobbyId, this.roundNumber()));
  }

  /** Réservé à l'host : coupe l'enregistrement pour tout le monde. */
  async endRecording(): Promise<void> {
    if (!this.isHost) return;
    await this.dubGame.startPlayback(this.lobbyId);
  }
}
