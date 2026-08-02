import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../../core/services/supabase';
import { Dub, DubPhase, VideoAsset, Vote } from '../../../core/models/types';

/** Une prise déposée, enrichie du joueur qui l'a faite. */
export interface DubWithPlayer extends Dub {
  players: { id: string; pseudo: string; avatar_url: string | null };
}

/** Un vote, enrichi du joueur qui l'a émis (les votes sont visibles de tous). */
export interface VoteWithVoter extends Vote {
  players: { id: string; pseudo: string; avatar_url: string | null };
}

/**
 * Règles propres au jeu de doublage : déroulé des phases d'une manche,
 * dépôt et validation des prises, vidéo de chaque manche.
 */
@Injectable({
  providedIn: 'root',
})
export class DubGameService {
  private readonly supabase = inject(SupabaseService).client;

  /** Vidéo à doubler pour une manche donnée. */
  async getRoundVideo(lobbyId: string, roundNumber: number): Promise<VideoAsset | null> {
    const { data } = await this.supabase
      .from('lobby_rounds')
      .select('videos(*)')
      .eq('lobby_id', lobbyId)
      .eq('round_number', roundNumber)
      .single();

    return (data as { videos: VideoAsset } | null)?.videos ?? null;
  }

  async getPhase(lobbyId: string): Promise<{ phase: DubPhase; playback_index: number } | null> {
    const { data } = await this.supabase
      .from('dub_phases')
      .select('phase, playback_index')
      .eq('lobby_id', lobbyId)
      .maybeSingle();

    return data as { phase: DubPhase; playback_index: number } | null;
  }

  /** Réservé à l'host : ouvre la phase d'enregistrement d'une manche. */
  async openRecording(lobbyId: string): Promise<void> {
    await this.supabase
      .from('dub_phases')
      .upsert(
        { lobby_id: lobbyId, phase: 'recording', playback_index: 0, updated_at: new Date() },
        { onConflict: 'lobby_id' },
      );
  }

  /** Réservé à l'host : coupe l'enregistrement et lance la diffusion. */
  async startPlayback(lobbyId: string): Promise<void> {
    await this.supabase
      .from('dub_phases')
      .update({ phase: 'playback', playback_index: 0, updated_at: new Date() })
      .eq('lobby_id', lobbyId);
  }

  /** Réservé à l'host : avance la diffusion au doublage suivant. */
  async setPlaybackIndex(lobbyId: string, index: number): Promise<void> {
    await this.supabase
      .from('dub_phases')
      .update({ playback_index: index, updated_at: new Date() })
      .eq('lobby_id', lobbyId);
  }

  /** Réservé à l'host : ouvre la phase de vote une fois tout diffusé. */
  async openVoting(lobbyId: string): Promise<void> {
    await this.supabase
      .from('dub_phases')
      .update({ phase: 'voting', updated_at: new Date() })
      .eq('lobby_id', lobbyId);
  }

  /**
   * Dépose ou remplace la prise du joueur pour cette manche.
   * Tant que le joueur n'a pas validé, chaque nouvelle prise écrase la précédente.
   */
  async saveTake(
    lobbyId: string,
    roundNumber: number,
    playerId: string,
    profileId: string,
    audio: Blob,
  ): Promise<{ error: string | null }> {
    const path = `${lobbyId}/${roundNumber}/${profileId}.webm`;

    const { error: uploadError } = await this.supabase.storage
      .from('dubs')
      .upload(path, audio, { upsert: true, contentType: audio.type || 'audio/webm' });

    if (uploadError) {
      return { error: "L'envoi de ta prise a échoué. Réessaie." };
    }

    const { error } = await this.supabase.from('dubs').upsert(
      {
        lobby_id: lobbyId,
        round_number: roundNumber,
        player_id: playerId,
        audio_storage_path: path,
        is_locked: false,
      },
      { onConflict: 'lobby_id,round_number,player_id' },
    );

    return { error: error ? 'Ta prise n\u2019a pas pu être enregistrée.' : null };
  }

  /** Fige la prise du joueur : il ne peut plus la refaire, il est prêt. */
  async lockTake(
    lobbyId: string,
    roundNumber: number,
    playerId: string,
  ): Promise<{ error: string | null }> {
    const { error } = await this.supabase
      .from('dubs')
      .update({ is_locked: true })
      .eq('lobby_id', lobbyId)
      .eq('round_number', roundNumber)
      .eq('player_id', playerId);

    return { error: error?.message ?? null };
  }

  /** Enregistre le vote du joueur sur un doublage. Un seul vote par doublage. */
  async castVote(
    lobbyId: string,
    roundNumber: number,
    dubId: string,
    voterPlayerId: string,
    value: -1 | 0 | 1 | 2,
  ): Promise<{ error: string | null }> {
    const { error } = await this.supabase.from('votes').upsert(
      {
        lobby_id: lobbyId,
        round_number: roundNumber,
        dub_id: dubId,
        voter_player_id: voterPlayerId,
        value,
      },
      { onConflict: 'dub_id,voter_player_id' },
    );

    if (error) {
      // Le seul cas courant : deuxième super like dans la même manche,
      // bloqué par l'index unique côté base.
      return {
        error: error.message.includes('votes_one_super_like_per_round')
          ? 'Tu as déjà utilisé ton super like sur cette manche.'
          : 'Ton vote n\u2019a pas pu être enregistré.',
      };
    }
    return { error: null };
  }

  /** Tous les votes d'une manche, avec leur votant (les votes sont publics). */
  async listVotes(lobbyId: string, roundNumber: number): Promise<VoteWithVoter[]> {
    const { data, error } = await this.supabase
      .from('votes')
      .select('*, players!votes_voter_player_id_fkey(id, pseudo, avatar_url)')
      .eq('lobby_id', lobbyId)
      .eq('round_number', roundNumber);

    if (error) throw error;
    return (data ?? []) as VoteWithVoter[];
  }

  subscribeToVotes(lobbyId: string, onChange: () => void): RealtimeChannel {
    return this.supabase
      .channel(`votes:${lobbyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes', filter: `lobby_id=eq.${lobbyId}` },
        onChange,
      )
      .subscribe();
  }

  /**
   * Réservé à l'host : clôt la manche. Passe à la manche suivante, ou
   * termine la partie s'il n'en reste plus.
   */
  async endRound(lobbyId: string, currentRound: number, roundsCount: number): Promise<void> {
    if (currentRound >= roundsCount) {
      await this.supabase.from('lobbies').update({ status: 'finished' }).eq('id', lobbyId);
      return;
    }

    await this.supabase
      .from('lobbies')
      .update({ current_round: currentRound + 1 })
      .eq('id', lobbyId);

    await this.supabase
      .from('dub_phases')
      .update({ phase: 'recording', playback_index: 0, updated_at: new Date() })
      .eq('lobby_id', lobbyId);
  }

  /** Toutes les prises d'une manche, avec leur auteur. */
  async listDubs(lobbyId: string, roundNumber: number): Promise<DubWithPlayer[]> {
    const { data, error } = await this.supabase
      .from('dubs')
      .select('*, players(id, pseudo, avatar_url)')
      .eq('lobby_id', lobbyId)
      .eq('round_number', roundNumber)
      .order('submitted_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as DubWithPlayer[];
  }

  /** URL d'écoute d'une prise enregistrée. */
  audioUrl(storagePath: string): string {
    return this.supabase.storage.from('dubs').getPublicUrl(storagePath).data.publicUrl;
  }

  subscribeToDubs(lobbyId: string, onChange: () => void): RealtimeChannel {
    return this.supabase
      .channel(`dubs:${lobbyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dubs', filter: `lobby_id=eq.${lobbyId}` },
        onChange,
      )
      .subscribe();
  }

  subscribeToPhase(lobbyId: string, onChange: (phase: DubPhase, index: number) => void): RealtimeChannel {
    return this.supabase
      .channel(`dub_phases:${lobbyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dub_phases', filter: `lobby_id=eq.${lobbyId}` },
        (payload) => {
          const row = payload.new as { phase: DubPhase; playback_index: number };
          onChange(row.phase, row.playback_index);
        },
      )
      .subscribe();
  }
}
