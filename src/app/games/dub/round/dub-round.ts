import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
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
import { SoundService } from '../../../core/services/sound';
import { AppVolumeService } from '../../../core/services/app-volume';
import { Lobby, Player, VideoAsset } from '../../../core/models/types';
import { Scoreboard } from '../../../shared/scoreboard/scoreboard';
import { TopBar } from '../../../shared/top-bar/top-bar';
import { LoadingOverlay } from '../../../shared/loading-overlay/loading-overlay';

@Component({
  selector: 'app-dub-round',
  imports: [LoadingOverlay, TopBar, Scoreboard],
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
  private readonly sound = inject(SoundService);
  readonly auth = inject(AuthService);
  readonly volumeService = inject(AppVolumeService);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
  private readonly reviewAudioRef = viewChild<ElementRef<HTMLAudioElement>>('reviewAudioEl');

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
  /** Vrai pendant la relecture de sa prise : la vidéo suit l'audio. */
  readonly reviewing = signal(false);

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

  constructor() {
    // Le volume choisi dans le menu sert de réglage de départ pour la
    // vidéo ; les contrôles natifs restent libres de le changer ensuite.
    effect(() => {
      const volume = this.volumeService.volume();
      const video = this.videoRef()?.nativeElement;
      const reviewAudio = this.reviewAudioRef()?.nativeElement;
      if (video) video.volume = volume;
      if (reviewAudio) reviewAudio.volume = volume;
    });
  }

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

      // Reprise après rechargement : si la partie a avancé pendant notre
      // absence, direction le bon écran plutôt qu'une manche périmée.
      const screen = this.dubGame.resolveScreen(lobby, phase?.phase ?? null);
      if (screen !== 'manche') {
        this.router.navigate(['/jeu/doublage', this.lobbyId, screen]);
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

      this.sound.playChime();
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

  /**
   * Coupe ou remet le son de la vidéo. Utilisable en pleine prise :
   * le choix est mémorisé et réappliqué au démarrage des prises suivantes.
   */
  toggleMute(): void {
    const el = this.videoRef()?.nativeElement;
    const next = !this.muted();
    this.muted.set(next);
    if (el) el.muted = next;
  }

  /* ---------- Relecture de sa prise, vidéo synchronisée ---------- */

  /** L'audio de la prise pilote la vidéo : play, pause et déplacements. */
  async onReviewPlay(): Promise<void> {
    const video = this.videoRef()?.nativeElement;
    const audio = this.reviewAudioRef()?.nativeElement;
    if (!video || !audio) return;

    this.reviewing.set(true);
    // Pendant la relecture, on n'entend que le doublage.
    video.muted = true;
    video.currentTime = audio.currentTime;

    try {
      await video.play();
    } catch {
      // Lecture vidéo refusée par le navigateur : l'audio continue seul.
    }
  }

  onReviewPause(): void {
    this.videoRef()?.nativeElement.pause();
  }

  /** L'utilisateur a déplacé le curseur de l'audio : la vidéo suit. */
  onReviewSeek(): void {
    const video = this.videoRef()?.nativeElement;
    const audio = this.reviewAudioRef()?.nativeElement;
    if (video && audio) video.currentTime = audio.currentTime;
  }

  /** Corrige la dérive éventuelle entre l'audio et la vidéo. */
  onReviewTimeUpdate(): void {
    const video = this.videoRef()?.nativeElement;
    const audio = this.reviewAudioRef()?.nativeElement;
    if (!video || !audio || video.paused) return;

    if (Math.abs(video.currentTime - audio.currentTime) > 0.25) {
      video.currentTime = audio.currentTime;
    }
  }

  onReviewEnded(): void {
    this.reviewing.set(false);
    const video = this.videoRef()?.nativeElement;
    if (video) {
      video.pause();
      // On rend le son original pour la prise suivante, sauf si coupé exprès.
      video.muted = this.muted();
    }
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
    this.reviewing.set(false);
    this.reviewAudioRef()?.nativeElement.pause();
    el.muted = this.muted();

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
