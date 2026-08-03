import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LobbyService } from '../../../core/services/lobby';
import { TopBar } from '../../../shared/top-bar/top-bar';
import { LoadingOverlay } from '../../../shared/loading-overlay/loading-overlay';

@Component({
  selector: 'app-join-lobby',
  imports: [FormsModule, TopBar, LoadingOverlay],
  templateUrl: './join-lobby.html',
  styleUrl: './join-lobby.scss',
})
export class JoinLobby implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly lobbyService = inject(LobbyService);
  private readonly router = inject(Router);

  readonly code = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Vrai si on arrive via un lien direct (/rejoindre/:code) plutôt que la
   *  saisie manuelle : affiche un message d'attente au lieu du formulaire
   *  vide le temps de la première tentative. */
  readonly autoJoining = signal(false);

  ngOnInit(): void {
    const codeFromUrl = this.route.snapshot.paramMap.get('code');
    if (codeFromUrl) {
      this.code.set(codeFromUrl.toUpperCase());
      this.autoJoining.set(true);
      void this.submit();
    }
  }

  async submit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    const { lobby, error } = await this.lobbyService.joinLobby(this.code());
    this.loading.set(false);

    if (error || !lobby) {
      // Le lien était mauvais ou périmé : on repasse en formulaire manuel,
      // code déjà rempli, pour que la personne puisse corriger sans tout
      // retaper.
      this.autoJoining.set(false);
      this.error.set(error ?? 'Code invalide.');
      return;
    }
    this.router.navigate(['/lobby', lobby.id]);
  }
}
