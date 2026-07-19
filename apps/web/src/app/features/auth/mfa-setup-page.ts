import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthStore } from '../../core/auth/auth.store';
import { QrService } from '../../core/qr.service';

type Stage = 'loading' | 'scan' | 'done' | 'error';

@Component({
  selector: 'app-mfa-setup-page',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <div class="auth-wrap">
      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>Set up two-factor authentication</mat-card-title>
          @if (forced()) {
            <mat-card-subtitle>
              An administrator requires MFA on this account before you can continue.
            </mat-card-subtitle>
          }
        </mat-card-header>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-content>
          @switch (stage()) {
            @case ('loading') {
              <p class="hint">Preparing your enrollment…</p>
            }
            @case ('error') {
              <p class="error" role="alert">{{ error() }}</p>
              <button matButton="filled" (click)="begin()">Try again</button>
            }
            @case ('scan') {
              <ol class="steps">
                <li>Scan this QR code with your authenticator app (or add the key manually).</li>
                <li>Enter the 6-digit code the app shows to confirm.</li>
              </ol>
              @if (qrDataUrl()) {
                <img class="qr" [src]="qrDataUrl()" alt="TOTP enrollment QR code" />
              }
              <p class="manual">
                Manual key: <code>{{ manualSecret() }}</code>
              </p>
              <form [formGroup]="codeForm" (ngSubmit)="verify()">
                <mat-form-field appearance="outline" class="full">
                  <mat-label>6-digit code</mat-label>
                  <input
                    matInput
                    formControlName="code"
                    autocomplete="one-time-code"
                    inputmode="numeric"
                  />
                </mat-form-field>
                @if (error()) {
                  <p class="error" role="alert">{{ error() }}</p>
                }
                <button
                  matButton="filled"
                  type="submit"
                  class="full"
                  [disabled]="codeForm.invalid || busy()"
                >
                  Confirm and enable MFA
                </button>
              </form>
            }
            @case ('done') {
              <p>
                <strong>MFA is on.</strong> Store these one-time recovery codes somewhere safe —
                each works once if you lose your authenticator, and they will never be shown again.
              </p>
              <div class="codes">
                @for (code of recoveryCodes(); track code) {
                  <code>{{ code }}</code>
                }
              </div>
              <button matButton (click)="copyCodes()">
                {{ copied() ? 'Copied ✓' : 'Copy all codes' }}
              </button>
              <mat-checkbox [(ngModel)]="acknowledged" [ngModelOptions]="{ standalone: true }">
                I saved my recovery codes
              </mat-checkbox>
              <button matButton="filled" class="full" [disabled]="!acknowledged" (click)="finish()">
                Continue
              </button>
            }
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .auth-wrap {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 16px;
    }
    mat-card {
      width: min(480px, 100%);
    }
    .full {
      width: 100%;
    }
    .error {
      color: var(--mat-sys-error, #b3261e);
      margin: 0 0 12px;
    }
    .hint {
      opacity: 0.75;
    }
    .steps {
      margin: 0 0 8px;
      padding-left: 20px;
    }
    .qr {
      display: block;
      margin: 8px auto;
      border-radius: 8px;
    }
    .manual {
      text-align: center;
      word-break: break-all;
      opacity: 0.85;
    }
    .codes {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin: 12px 0;
      code {
        text-align: center;
        padding: 4px;
        background: var(--mat-sys-surface-container, rgba(0, 0, 0, 0.05));
        border-radius: 4px;
      }
    }
    mat-checkbox {
      display: block;
      margin: 8px 0;
    }
    form {
      display: flex;
      flex-direction: column;
      margin-top: 8px;
      gap: 4px;
    }
  `,
})
export class MfaSetupPage implements OnInit {
  private readonly api = inject(AuthApi);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly qr = inject(QrService);
  private readonly clipboard = inject(Clipboard);
  private readonly fb = inject(FormBuilder);

  protected readonly stage = signal<Stage>('loading');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly qrDataUrl = signal<string | null>(null);
  protected readonly manualSecret = signal<string>('');
  protected readonly recoveryCodes = signal<string[]>([]);
  protected readonly copied = signal(false);
  protected readonly forced = computed(() => {
    const user = this.store.user();
    return user ? user.mfaEnforced && !user.mfaEnabled : false;
  });
  protected acknowledged = false;

  protected readonly codeForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(32)]],
  });

  ngOnInit(): void {
    void this.begin();
  }

  protected async begin(): Promise<void> {
    this.stage.set('loading');
    this.error.set(null);
    try {
      const { otpauthUri } = await firstValueFrom(this.api.mfaSetup());
      this.manualSecret.set(new URL(otpauthUri).searchParams.get('secret') ?? '');
      this.qrDataUrl.set(await this.qr.toDataUrl(otpauthUri));
      this.stage.set('scan');
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 409
          ? 'MFA is already enabled on this account.'
          : 'Could not start MFA enrollment. Please try again.',
      );
      this.stage.set('error');
    }
  }

  protected async verify(): Promise<void> {
    if (this.codeForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { recoveryCodes } = await firstValueFrom(
        this.api.mfaVerify({ code: this.codeForm.getRawValue().code }),
      );
      this.recoveryCodes.set(recoveryCodes);
      await this.store.init(); // refresh user (mfaEnabled now true, fresh cookies applied)
      this.stage.set('done');
    } catch {
      this.error.set('That code was not accepted — wait for a fresh one and try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected copyCodes(): void {
    this.clipboard.copy(this.recoveryCodes().join('\n'));
    this.copied.set(true);
  }

  protected async finish(): Promise<void> {
    await this.router.navigate(['/dashboard']);
  }
}
