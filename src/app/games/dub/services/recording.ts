import { Injectable, signal } from '@angular/core';

/**
 * Capture micro d'une prise de doublage.
 * Une prise = une lecture complète de la vidéo : l'enregistrement démarre
 * avec la vidéo et s'arrête à la fin, pour que le doublage reste calé sur
 * l'image.
 */
@Injectable({
  providedIn: 'root',
})
export class RecordingService {
  readonly isRecording = signal(false);
  readonly micError = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  /** Demande l'accès micro une seule fois, puis réutilise le flux. */
  private async getStream(): Promise<MediaStream> {
    if (this.stream) return this.stream;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    return this.stream;
  }

  private pickMimeType(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
  }

  async start(): Promise<{ error: string | null }> {
    this.micError.set(null);

    try {
      const stream = await this.getStream();
      const mimeType = this.pickMimeType();

      this.chunks = [];
      this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.start();
      this.isRecording.set(true);
      return { error: null };
    } catch {
      const message =
        'Micro inaccessible. Autorise le micro dans ton navigateur pour pouvoir doubler.';
      this.micError.set(message);
      return { error: message };
    }
  }

  /** Arrête la prise en cours et retourne l'audio capturé. */
  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === 'inactive') {
        this.isRecording.set(false);
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        this.isRecording.set(false);
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.stop();
    });
  }

  /** Libère le micro (voyant du navigateur éteint) en fin de partie. */
  release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
