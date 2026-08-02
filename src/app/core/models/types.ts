import { GameId } from './game-registry';

export interface Profile {
  id: string;
  pseudo: string;
  avatar_url: string | null;
  created_at: string;
}

/**
 * Statuts génériques d'un lobby, valables pour tous les jeux.
 * 'in_game' couvre tout le déroulé propre au jeu : chaque jeu gère ses
 * propres phases internes (pour le doublage : enregistrement, diffusion,
 * vote) via la table lobby_phase, sans polluer le noyau.
 */
export type LobbyStatus = 'waiting' | 'in_game' | 'finished';

export interface Lobby {
  id: string;
  code: string;
  host_id: string;
  game_id: GameId;
  status: LobbyStatus;
  /** Réglages propres au jeu (JSON libre). Pour le doublage :
   *  { videoIds: string[] } */
  settings: Record<string, unknown>;
  rounds_count: number;
  current_round: number;
  created_at: string;
}

export interface Player {
  id: string;
  lobby_id: string;
  profile_id: string;
  pseudo: string;
  avatar_url: string | null;
  score: number;
  joined_at: string;
}

/* ---------- Spécifique au jeu de doublage ---------- */

export interface VideoAsset {
  id: string;
  owner_id: string | null;
  title: string;
  storage_key: string;
  thumbnail_key: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface LobbyRound {
  lobby_id: string;
  round_number: number;
  video_id: string;
}

/** Phase interne d'une manche de doublage, pilotée par l'host. */
export type DubPhase = 'recording' | 'playback' | 'voting' | 'recap';

export interface Dub {
  id: string;
  lobby_id: string;
  round_number: number;
  player_id: string;
  audio_storage_path: string;
  /** true dès que le joueur a cliqué sur "Valider" : sa prise est figée. */
  is_locked: boolean;
  submitted_at: string;
}

/** value: -1 (dislike), 0 (neutre), 1 (like), 2 (super like, max 1 par manche par votant) */
export interface Vote {
  id: string;
  dub_id: string;
  lobby_id: string;
  round_number: number;
  voter_player_id: string;
  value: -1 | 0 | 1 | 2;
  created_at: string;
}

export interface DubSettings {
  videoIds: string[];
}
