import { Component, input } from '@angular/core';
import { Player } from '../../core/models/types';

/**
 * Colonne de scores affichée à gauche pendant toute la partie.
 * Générique : utilisable par n'importe quel jeu de la plateforme.
 */
@Component({
  selector: 'app-scoreboard',
  imports: [],
  templateUrl: './scoreboard.html',
  styleUrl: './scoreboard.scss',
})
export class Scoreboard {
  readonly players = input.required<Player[]>();
  /** Joueurs à marquer comme prêts (ex : ont validé leur prise). */
  readonly readyPlayerIds = input<string[]>([]);
  readonly myPlayerId = input<string | null>(null);

  get ranked(): Player[] {
    return [...this.players()].sort((a, b) => b.score - a.score);
  }

  isReady(playerId: string): boolean {
    return this.readyPlayerIds().includes(playerId);
  }
}
