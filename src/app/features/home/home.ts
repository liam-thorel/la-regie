import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { GAMES } from '../../core/models/game-registry';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly games = GAMES;

  async logout(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
