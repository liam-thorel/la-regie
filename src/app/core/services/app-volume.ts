import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'olygames:volume';

/**
 * Volume unique pour tous les lecteurs audio/vidéo du jeu, mémorisé sur
 * l'appareil. Existe surtout parce que la diffusion des doublages n'a pas
 * de contrôles natifs (la vidéo est forcée en muet, seul le doublage
 * s'entend) : sans ce réglage, aucun moyen d'ajuster le volume à ce moment.
 */
@Injectable({
  providedIn: 'root',
})
export class AppVolumeService {
  readonly volume = signal(this.readStored());

  private readStored(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw !== null ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
    } catch {
      return 1;
    }
  }

  setVolume(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this.volume.set(clamped);
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // Stockage indisponible (navigation privée stricte) : le réglage
      // reste actif pour la session en cours, simplement pas mémorisé.
    }
  }
}
