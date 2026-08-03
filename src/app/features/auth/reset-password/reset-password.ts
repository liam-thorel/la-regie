import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { WheelLogo } from '../../../shared/wheel-logo/wheel-logo';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, WheelLogo],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
})
export class ResetPassword {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    this.error.set(null);

    if (this.password().length < 6) {
      this.error.set('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.error.set('Les deux mots de passe ne correspondent pas.');
      return;
    }

    this.loading.set(true);
    const { error } = await this.auth.updatePassword(this.password());
    this.loading.set(false);

    if (error) {
      this.error.set('Le lien a peut-être expiré. Redemande une réinitialisation.');
      return;
    }
    this.router.navigateByUrl('/');
  }
}
