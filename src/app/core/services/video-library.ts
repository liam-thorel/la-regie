import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { VideoAsset } from '../models/types';
import { environment } from '../../../environments/environment';

/**
 * Bibliothèque de vidéos disponibles pour composer un lobby.
 * Les fichiers eux-mêmes vivent sur Cloudflare R2 ; cette table ne stocke
 * que les métadonnées (titre, clé R2, miniature, durée).
 */
@Injectable({
  providedIn: 'root',
})
export class VideoLibraryService {
  private readonly supabase = inject(SupabaseService).client;

  async listVideos(): Promise<VideoAsset[]> {
    const { data, error } = await this.supabase
      .from('videos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as VideoAsset[];
  }

  /** Construit l'URL publique R2 d'une vidéo à partir de sa clé de stockage. */
  publicUrl(storageKey: string): string {
    return `${environment.r2PublicBaseUrl}/${storageKey}`;
  }

  /**
   * Envoie une vidéo sur R2 puis enregistre ses métadonnées.
   * L'URL d'upload est signée par une Edge Function : la clé secrète R2
   * reste côté serveur et n'est jamais exposée au navigateur.
   */
  async uploadVideo(
    file: File,
    title: string,
    onProgress?: (percent: number) => void,
  ): Promise<{ error: string | null }> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();

    if (!session) {
      return { error: 'Session expirée, reconnecte-toi.' };
    }

    // 1. Demander une URL d'upload signée.
    const { data: signed, error: signError } = await this.supabase.functions.invoke(
      'r2-upload-url',
      { body: { fileName: file.name, contentType: file.type } },
    );

    if (signError || !signed?.uploadUrl || !signed?.storageKey) {
      return { error: "Impossible de préparer l'envoi. Vérifie la configuration R2." };
    }

    // 2. Envoyer le fichier directement sur R2, avec suivi de progression.
    try {
      await this.putWithProgress(signed.uploadUrl, file, onProgress);
    } catch {
      return { error: "L'envoi de la vidéo a échoué." };
    }

    // 3. Enregistrer les métadonnées.
    const duration = await this.readDuration(file).catch(() => null);

    const { error } = await this.supabase.from('videos').insert({
      owner_id: session.user.id,
      title,
      storage_key: signed.storageKey,
      duration_seconds: duration,
    });

    return { error: error ? 'La vidéo est envoyée mais son enregistrement a échoué.' : null };
  }

  /** XMLHttpRequest plutôt que fetch : c'est le seul moyen d'avoir la progression. */
  private putWithProgress(
    url: string,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', url);
      request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      request.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      request.onload = () =>
        request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('upload'));
      request.onerror = () => reject(new Error('upload'));
      request.send(file);
    });
  }

  /** Lit la durée de la vidéo côté navigateur, pour information. */
  private readDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const element = document.createElement('video');
      element.preload = 'metadata';
      element.onloadedmetadata = () => {
        URL.revokeObjectURL(element.src);
        resolve(Number.isFinite(element.duration) ? Math.round(element.duration) : null);
      };
      element.onerror = () => resolve(null);
      element.src = URL.createObjectURL(file);
    });
  }

  /**
   * Supprime une vidéo : la fiche en base et le fichier sur R2.
   * Le `select()` est important : sans lui, une suppression refusée par les
   * règles de sécurité renverrait un succès silencieux avec zéro ligne
   * supprimée, et l'écran ne réagirait pas.
   */
  async deleteVideo(video: VideoAsset): Promise<{ error: string | null }> {
    const { data, error } = await this.supabase
      .from('videos')
      .delete()
      .eq('id', video.id)
      .select();

    if (error) {
      return { error: `Suppression impossible : ${error.message}` };
    }

    if (!data || data.length === 0) {
      return {
        error:
          "Suppression refusée. Vérifie que ton compte figure bien dans la table des administrateurs.",
      };
    }

    // Le fichier R2 est retiré ensuite : si ça échoue, la fiche est déjà
    // supprimée, on le signale sans bloquer.
    const { error: storageError } = await this.supabase.functions.invoke('r2-delete-object', {
      body: { storageKey: video.storage_key },
    });

    if (storageError) {
      return {
        error: 'Vidéo retirée de la liste, mais le fichier est toujours sur R2.',
      };
    }

    return { error: null };
  }
}
