/**
 * Registre des jeux de la plateforme.
 *
 * Pour ajouter un jeu plus tard :
 *   1. créer un dossier src/app/games/<id>/ avec ses écrans et son fichier de routes,
 *   2. ajouter une entrée ici,
 *   3. brancher la route paresseuse dans app.routes.ts.
 * Le reste (comptes, création/rejoint de lobby, code d'invitation, salle
 * d'attente, joueurs en temps réel) est mutualisé et n'a pas à être réécrit.
 */
export type GameId = 'doublage';

export interface GameDefinition {
  id: GameId;
  /** Nom affiché sur l'accueil. */
  name: string;
  /** Une phrase qui explique le principe, affichée sous le nom. */
  tagline: string;
  /** Nombre minimum de joueurs pour que l'host puisse lancer. */
  minPlayers: number;
  /** Route de configuration du lobby, propre au jeu. */
  setupRoute: string;
  /** Route du premier écran de jeu, appelée au lancement de la partie. */
  playRoute: (lobbyId: string) => string;
  /** false = jeu affiché sur l'accueil mais pas encore jouable. */
  available: boolean;
  /** Trophées possibles pour ce jeu (clé -> libellé), affichés sur la page
   *  de profil. Absent pour un jeu qui n'a pas de trophées. */
  trophies?: Record<string, string>;
}

export const GAMES: GameDefinition[] = [
  {
    id: 'doublage',
    name: 'Doublage Party',
    tagline: 'Réinventez la bande-son. Le public tranche.',
    minPlayers: 2,
    setupRoute: '/jeu/doublage/creer',
    playRoute: (lobbyId) => `/jeu/doublage/${lobbyId}/manche`,
    available: true,
    trophies: {
      hater: 'Le Hater',
      liker: 'Le Liker',
      goat: 'Le GOAT',
    },
  },
];

export function getGame(id: GameId | string): GameDefinition | undefined {
  return GAMES.find((game) => game.id === id);
}
