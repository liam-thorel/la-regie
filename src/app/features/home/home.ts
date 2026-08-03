import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { WheelLogo } from '../../shared/wheel-logo/wheel-logo';
import { AuthService } from '../../core/services/auth';
import { GAMES } from '../../core/models/game-registry';

@Component({
  selector: 'app-home',
  imports: [RouterLink, WheelLogo],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly games = GAMES;

  /** Une couleur de nacelle par jeu, dans l'ordre de la palette. */
  readonly tileColors = ['--c-pink', '--c-blurple', '--c-teal', '--c-gold', '--c-green', '--c-red'];

  colorFor(index: number): string {
    return `var(${this.tileColors[index % this.tileColors.length]})`;
  }

  async logout(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
