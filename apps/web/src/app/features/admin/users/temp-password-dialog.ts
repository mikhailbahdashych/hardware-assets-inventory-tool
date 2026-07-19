import { Component, inject, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface TempPasswordDialogData {
  email: string;
  tempPassword: string;
  /** 'created' or 'reset' — copy changes slightly. */
  reason: 'created' | 'reset';
}

@Component({
  selector: 'app-temp-password-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>One-time temporary password</h2>
    <mat-dialog-content>
      <p>
        Hand this password to <strong>{{ data.email }}</strong> over a trusted channel. They must
        change it at first sign-in, and it will <strong>never be shown again</strong>.
      </p>
      <div class="pw">
        <code>{{ data.tempPassword }}</code>
        <button matButton (click)="copy()">{{ copied() ? 'Copied ✓' : 'Copy' }}</button>
      </div>
      <mat-checkbox [(ngModel)]="acknowledged"
        >I passed the password on / stored it safely</mat-checkbox
      >
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton="filled" [mat-dialog-close]="true" [disabled]="!acknowledged">Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    .pw {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 12px 0;
      code {
        font-size: 1.2rem;
        letter-spacing: 0.08em;
        padding: 8px 12px;
        background: var(--mat-sys-surface-container, rgba(0, 0, 0, 0.06));
        border-radius: 6px;
      }
    }
    mat-dialog-content {
      max-width: 460px;
    }
  `,
})
export class TempPasswordDialog {
  protected readonly data = inject<TempPasswordDialogData>(MAT_DIALOG_DATA);
  private readonly clipboard = inject(Clipboard);
  protected readonly copied = signal(false);
  protected acknowledged = false;

  protected copy(): void {
    this.clipboard.copy(this.data.tempPassword);
    this.copied.set(true);
  }
}
