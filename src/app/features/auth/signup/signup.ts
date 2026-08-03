import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { WheelLogo } from '../../../shared/wheel-logo/wheel-logo';
import { AuthService } from '../../../core/services/auth';

@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink, WheelLogo],
  templateUrl: './signup.html',
  styleUrl: './signup.scss',
})
export class Signup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly pseudo = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  private avatarFile: File | null = null;
  readonly avatarPreview = signal<string | null>(null);

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.avatarFile = file;
    this.avatarPreview.set(file ? URL.createObjectURL(file) : null);
  }

  async submit(): Promise<void> {
    this.error.set(null);

    if (this.pseudo().trim().length < 2) {
      this.error.set('Choisis un pseudo d\u2019au moins 2 caractères.');
      return;
    }

    this.loading.set(true);
    const { error } = await this.auth.signUp(
      this.email(),
      this.password(),
      this.pseudo().trim(),
      this.avatarFile,
    );
    this.loading.set(false);

    if (error) {
      this.error.set(error);
      return;
    }
    this.router.navigateByUrl('/');
  }
}
