import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { WheelLogo } from '../../../shared/wheel-logo/wheel-logo';

@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink, WheelLogo],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);

  readonly email = signal('');
  readonly loading = signal(false);
  readonly sent = signal(false);

  async submit(): Promise<void> {
    this.loading.set(true);
    await this.auth.requestPasswordReset(this.email().trim());
    this.loading.set(false);
    // Message identique que l'adresse existe ou non : voir requestPasswordReset.
    this.sent.set(true);
  }
}
