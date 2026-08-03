import { Injectable, inject } from '@angular/core';
import { AppVolumeService } from './app-volume';

/**
 * Petits signaux sonores discrets (début de manche, à toi de voter),
 * générés directement via l'API Web Audio plutôt que des fichiers audio à
 * héberger : quelques notes pures, très courtes. Suit le volume réglé
 * dans le menu de l'appli, y compris à zéro (silence complet).
 */
@Injectable({
  providedIn: 'root',
})
export class SoundService {
  private readonly volumeService = inject(AppVolumeService);
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      // API indisponible (très vieux navigateur) : on reste silencieux.
      return null;
    }
  }

  /** Deux notes montantes et douces : "c'est parti" (début de manche). */
  playChime(): void {
    this.playTones([660, 880], 0.1);
  }

  /** Une seule note, plus brève : "à toi de jouer" (phase de vote). */
  playPing(): void {
    this.playTones([784], 0.12);
  }

  private playTones(frequencies: number[], noteDuration: number): void {
    const volume = this.volumeService.volume();
    if (volume <= 0) return;

    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    frequencies.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + i * noteDuration;

      oscillator.type = 'sine';
      oscillator.frequency.value = freq;

      // Montée puis décroissance douce, pour éviter tout clic sec.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16 * volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + noteDuration);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + noteDuration + 0.02);
    });
  }
}
