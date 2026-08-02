import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { Lobby, Player } from '../models/types';
import { GameId } from '../models/game-registry';

/**
 * Noyau de lobby, commun à tous les jeux de la plateforme : création,
 * code d'invitation, arrivée des joueurs, suivi temps réel, lancement.
 * Rien ici ne connaît les règles d'un jeu en particulier ; les réglages
 * spécifiques passent par le champ `settings`.
 */
@Injectable({
  providedIn: 'root',
})
export class LobbyService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  async createLobby(
    gameId: GameId,
    roundsCount: number,
    settings: Record<string, unknown>,
  ): Promise<{ lobby: Lobby | null; error: string | null }> {
    const profile = this.auth.currentProfile();
    if (!profile) {
      return { lobby: null, error: 'Vous devez être connecté.' };
    }

    const { data: lobby, error } = await this.supabase
      .from('lobbies')
      .insert({
        host_id: profile.id,
        game_id: gameId,
        rounds_count: roundsCount,
        settings,
      })
      .select('*')
      .single();

    if (error || !lobby) {
      return { lobby: null, error: error?.message ?? 'Création du lobby impossible.' };
    }

    const { error: playerError } = await this.addSelfAsPlayer(lobby.id);
    if (playerError) {
      return { lobby: null, error: playerError };
    }

    return { lobby: lobby as Lobby, error: null };
  }

  /** Rejoint une partie encore en salle d'attente via son code à 6 caractères. */
  async joinLobby(code: string): Promise<{ lobby: Lobby | null; error: string | null }> {
    const { data: lobby, error } = await this.supabase
      .from('lobbies')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('status', 'waiting')
      .maybeSingle();

    if (error || !lobby) {
      return { lobby: null, error: 'Code invalide, ou partie déjà lancée.' };
    }

    const { error: playerError } = await this.addSelfAsPlayer(lobby.id);
    if (playerError) {
      return { lobby: null, error: playerError };
    }

    return { lobby: lobby as Lobby, error: null };
  }

  /** Inscrit le joueur connecté dans le lobby (idempotent : reconnexion possible). */
  private async addSelfAsPlayer(lobbyId: string): Promise<{ error: string | null }> {
    const profile = this.auth.currentProfile();
    if (!profile) {
      return { error: 'Vous devez être connecté.' };
    }

    const { error } = await this.supabase.from('players').upsert(
      {
        lobby_id: lobbyId,
        profile_id: profile.id,
        pseudo: profile.pseudo,
        avatar_url: profile.avatar_url,
      },
      { onConflict: 'lobby_id,profile_id' },
    );

    return { error: error?.message ?? null };
  }

  async getLobby(lobbyId: string): Promise<Lobby | null> {
    const { data } = await this.supabase.from('lobbies').select('*').eq('id', lobbyId).single();
    return data as Lobby | null;
  }

  async listPlayers(lobbyId: string): Promise<Player[]> {
    const { data, error } = await this.supabase
      .from('players')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('joined_at', { ascending: true });

    if (error) throw error;
    return data as Player[];
  }

  /** Retrouve la ligne `players` du joueur connecté dans ce lobby. */
  async getMyPlayer(lobbyId: string): Promise<Player | null> {
    const profile = this.auth.currentProfile();
    if (!profile) return null;

    const { data } = await this.supabase
      .from('players')
      .select('*')
      .eq('lobby_id', lobbyId)
      .eq('profile_id', profile.id)
      .maybeSingle();

    return data as Player | null;
  }

  /** Passe le lobby en partie lancée (réservé à l'host par les règles RLS). */
  async startGame(lobbyId: string): Promise<{ error: string | null }> {
    const { error } = await this.supabase
      .from('lobbies')
      .update({ status: 'in_game', current_round: 1 })
      .eq('id', lobbyId);

    return { error: error?.message ?? null };
  }

  /** Suit les arrivées de joueurs et les changements de score. */
  subscribeToPlayers(lobbyId: string, onChange: () => void): RealtimeChannel {
    return this.supabase
      .channel(`players:${lobbyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyId}` },
        onChange,
      )
      .subscribe();
  }

  /** Suit les changements du lobby lui-même (lancement, manche courante, fin). */
  subscribeToLobby(lobbyId: string, onChange: (lobby: Lobby) => void): RealtimeChannel {
    return this.supabase
      .channel(`lobby:${lobbyId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` },
        (payload) => onChange(payload.new as Lobby),
      )
      .subscribe();
  }
}
