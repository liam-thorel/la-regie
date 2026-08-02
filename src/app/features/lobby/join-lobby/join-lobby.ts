import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LobbyService } from '../../../core/services/lobby';

@Component({
  selector: 'app-join-lobby',
  imports: [FormsModule],
  templateUrl: './join-lobby.html',
  styleUrl: './join-lobby.scss',
})
export class JoinLobby {
  private readonly lobbyService = inject(LobbyService);
  private readonly router = inject(Router);

  readonly code = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    const { lobby, error } = await this.lobbyService.joinLobby(this.code());
    this.loading.set(false);

    if (error || !lobby) {
      this.error.set(error ?? 'Code invalide.');
      return;
    }
    this.router.navigate(['/lobby', lobby.id]);
  }
}
