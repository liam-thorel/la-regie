import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { Profile } from '../models/types';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;

  /** Profil du joueur actuellement connecté (null tant que non chargé/connecté). */
  readonly currentProfile = signal<Profile | null>(null);
  /** Passe à true une fois que l'état de session initial a été vérifié. */
  readonly ready = signal(false);
  /** Vrai si le compte connecté peut gérer la bibliothèque de vidéos.
   *  L'autorité reste la base (table admins + RLS) : ce signal ne sert
   *  qu'à masquer l'interface. */
  readonly isAdmin = signal(false);

  constructor() {
    // Récupère la session existante (utilisateur déjà connecté précédemment).
    this.supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id;
      if (userId) {
        Promise.all([this.loadProfile(userId), this.refreshAdminFlag()]).finally(() =>
          this.ready.set(true),
        );
      } else {
        this.ready.set(true);
      }
    });

    // Garde le profil synchronisé si la session change (connexion/déconnexion
    // dans un autre onglet, expiration du token, etc.)
    this.supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id) {
        this.loadProfile(session.user.id);
        this.refreshAdminFlag();
      } else {
        this.currentProfile.set(null);
        this.isAdmin.set(false);
      }
    });
  }

  private async loadProfile(userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error && data) {
      this.currentProfile.set(data as Profile);
    }
  }

  private async refreshAdminFlag(): Promise<void> {
    const { data } = await this.supabase.rpc('is_admin');
    this.isAdmin.set(data === true);
  }

  /**
   * Crée le compte (email + mot de passe), le profil (pseudo + avatar) et
   * connecte l'utilisateur. L'avatar est optionnel.
   */
  async signUp(
    email: string,
    password: string,
    pseudo: string,
    avatarFile: File | null,
  ): Promise<{ error: string | null }> {
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error || !data.user) {
      return { error: error?.message ?? 'Inscription impossible.' };
    }

    let avatarUrl: string | null = null;
    if (avatarFile) {
      const path = `${data.user.id}/${crypto.randomUUID()}-${avatarFile.name}`;
      const { error: uploadError } = await this.supabase.storage
        .from('avatars')
        .upload(path, avatarFile, { upsert: true });

      if (!uploadError) {
        avatarUrl = this.supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
    }

    const { error: profileError } = await this.supabase.from('profiles').insert({
      id: data.user.id,
      pseudo,
      avatar_url: avatarUrl,
    });

    if (profileError) {
      return { error: profileError.message };
    }

    await this.loadProfile(data.user.id);
    return { error: null };
  }

  async signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.currentProfile.set(null);
    this.isAdmin.set(false);
  }
}
