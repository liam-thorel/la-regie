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

    // 3. Générer et envoyer un aperçu. Best-effort : si ça échoue, la vidéo
    // reste utilisable, simplement sans miniature.
    const thumbnailKey = await this.uploadThumbnail(file, session.user.id).catch(() => null);

    // 4. Enregistrer les métadonnées.
    const duration = await this.readDuration(file).catch(() => null);

    const { error } = await this.supabase.from('videos').insert({
      owner_id: session.user.id,
      title,
      storage_key: signed.storageKey,
      thumbnail_key: thumbnailKey,
      duration_seconds: duration,
    });

    return { error: error ? 'La vidéo est envoyée mais son enregistrement a échoué.' : null };
  }

  /**
   * Capture une image représentative de la vidéo (pas la toute première
   * image, souvent noire) et l'envoie dans le bucket des miniatures.
   * Retourne le chemin de stockage, ou null si la capture échoue.
   */
  private async uploadThumbnail(file: File, userId: string): Promise<string | null> {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;

    const blob = await this.captureFrame(video).finally(() => URL.revokeObjectURL(url));
    if (!blob) return null;

    return this.storeThumbnail(blob, userId);
  }

  /**
   * Génère l'aperçu d'une vidéo déjà en ligne, à partir de son fichier sur
   * R2, sans avoir à la renvoyer. Pour dessiner une vidéo distante sur un
   * canvas sans le "tainter", elle doit être chargée en crossOrigin :
   * ça suppose que le bucket R2 autorise les requêtes GET en CORS depuis
   * ce site (voir le README, section Cloudflare R2).
   */
  async backfillThumbnail(video: VideoAsset): Promise<{ error: string | null }> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();

    if (!session) return { error: 'Session expirée, reconnecte-toi.' };

    const element = document.createElement('video');
    element.crossOrigin = 'anonymous';
    element.src = this.publicUrl(video.storage_key);

    const blob = await this.captureFrame(element);
    if (!blob) {
      return {
        error:
          "Aperçu impossible à générer. Vérifie que le bucket R2 autorise les requêtes GET en CORS depuis ce site.",
      };
    }

    const path = await this.storeThumbnail(blob, session.user.id);
    if (!path) return { error: "L'envoi de l'aperçu a échoué." };

    const { error } = await this.supabase
      .from('videos')
      .update({ thumbnail_key: path })
      .eq('id', video.id);

    return { error: error ? "L'aperçu a été créé mais l'enregistrement a échoué." : null };
  }

  private async storeThumbnail(blob: Blob, userId: string): Promise<string | null> {
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.storage
      .from('thumbnails')
      .upload(path, blob, { contentType: 'image/jpeg' });

    return error ? null : path;
  }

  /**
   * Attend qu'une image de la vidéo soit disponible, se place à mi-vidéo
   * (plus représentatif que la toute première image, souvent noire) et la
   * dessine sur un canvas recadré en 16/9. Un filet de sécurité de 6
   * secondes garantit que l'appel se termine toujours, même si la vidéo ne
   * charge jamais (format inhabituel, réseau, etc.) : sans lui, une
   * capture bloquée aurait aussi bloqué l'envoi de la vidéo elle-même.
   */
  private captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
    return new Promise((resolve) => {
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      let settled = false;
      const finish = (blob: Blob | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        resolve(blob);
      };

      const safety = setTimeout(() => {
        console.warn('Capture de miniature abandonnée après 6s.');
        finish(null);
      }, 6000);

      const draw = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');

        if (!ctx || !video.videoWidth) {
          finish(null);
          return;
        }

        // Recadrage "cover" centré : couvre le cadre 16/9 quel que soit le
        // ratio d'origine, sans bandes noires.
        const scale = Math.max(
          canvas.width / video.videoWidth,
          canvas.height / video.videoHeight,
        );
        const w = video.videoWidth * scale;
        const h = video.videoHeight * scale;
        ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);

        canvas.toBlob(
          (blob) => finish(blob),
          'image/jpeg',
          0.78,
        );
      };

      // 'loadeddata' garantit qu'une image est décodée (contrairement à
      // 'loadedmetadata', qui ne donne que durée et dimensions). On tente
      // ensuite de se placer à mi-vidéo ; si ce n'est pas possible on
      // dessine directement l'image déjà chargée plutôt que d'attendre
      // un 'seeked' qui pourrait ne jamais venir.
      video.onloadeddata = () => {
        const target = Math.min(1, (video.duration || 0) / 2);
        if (target > 0.05) {
          video.currentTime = target;
        } else {
          draw();
        }
      };
      video.onseeked = draw;
      video.onerror = () => {
        console.warn('Capture de miniature : la vidéo n\'a pas pu être chargée.');
        finish(null);
      };
    });
  }

  /** URL publique d'une miniature à partir de sa clé de stockage. */
  thumbnailUrl(key: string | null): string | null {
    if (!key) return null;
    return this.supabase.storage.from('thumbnails').getPublicUrl(key).data.publicUrl;
  }

  async renameVideo(videoId: string, title: string): Promise<{ error: string | null }> {
    const { data, error } = await this.supabase
      .from('videos')
      .update({ title })
      .eq('id', videoId)
      .select();

    if (error) return { error: 'Renommage impossible.' };
    if (!data || data.length === 0) {
      return { error: 'Renommage refusé : vérifie tes droits administrateur.' };
    }
    return { error: null };
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

  /** Lit la durée de la vidéo côté navigateur. Public : aussi utilisé par
   *  l'écran d'ajout pour avertir avant l'envoi d'une vidéo trop longue. */
  readDuration(file: File): Promise<number | null> {
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
