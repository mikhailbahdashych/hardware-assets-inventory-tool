import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SessionUser } from '@inventory/shared';
import { AuthStore } from '../../../core/auth/auth.store';
import { UsersApi } from './users.api';
import { UserDialog, UserDialogResult } from './user-dialog';
import { TempPasswordDialog } from './temp-password-dialog';

const COLUMNS = ['email', 'displayName', 'role', 'status', 'mfa', 'created', 'actions'];

@Component({
  selector: 'app-users-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './users-page.html',
  styleUrl: './users-page.scss',
})
export class UsersPage implements OnInit {
  private readonly api = inject(UsersApi);
  private readonly store = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly searchInput = new Subject<string>();

  protected readonly columns = COLUMNS;
  protected readonly users = signal<SessionUser[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly busy = signal(false);
  protected search = '';

  constructor() {
    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search = term;
        this.page.set(1);
        void this.load();
      });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected onSearch(term: string): void {
    this.searchInput.next(term);
  }

  protected onPage(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
    void this.load();
  }

  protected isSelf(user: SessionUser): boolean {
    return this.store.user()?.id === user.id;
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    try {
      const result = await firstValueFrom(
        this.api.list(this.page(), this.pageSize(), this.search || undefined),
      );
      this.users.set(result.items);
      this.total.set(result.total);
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not load users.'), 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async createUser(): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open<UserDialog, unknown, UserDialogResult>(UserDialog, {
          data: { mode: 'create' },
        })
        .afterClosed(),
    );
    if (!result?.email) return;
    try {
      const created = await firstValueFrom(
        this.api.create({
          email: result.email,
          displayName: result.displayName,
          role: result.role,
        }),
      );
      await firstValueFrom(
        this.dialog
          .open(TempPasswordDialog, {
            data: {
              email: created.user.email,
              tempPassword: created.tempPassword,
              reason: 'created',
            },
            disableClose: true,
          })
          .afterClosed(),
      );
      await this.load();
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not create the user.'), 'OK', {
        duration: 5000,
      });
    }
  }

  protected async editUser(user: SessionUser): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open<UserDialog, unknown, UserDialogResult>(UserDialog, {
          data: { mode: 'edit', user, isSelf: this.isSelf(user) },
        })
        .afterClosed(),
    );
    if (!result) return;
    try {
      await firstValueFrom(
        this.api.update(user.id, {
          displayName: result.displayName,
          role: result.role,
          isActive: result.isActive,
          mfaEnforced: result.mfaEnforced,
        }),
      );
      await this.load();
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not update the user.'), 'OK', {
        duration: 5000,
      });
    }
  }

  protected async resetPassword(user: SessionUser): Promise<void> {
    try {
      const { tempPassword } = await firstValueFrom(this.api.resetPassword(user.id));
      await firstValueFrom(
        this.dialog
          .open(TempPasswordDialog, {
            data: { email: user.email, tempPassword, reason: 'reset' },
            disableClose: true,
          })
          .afterClosed(),
      );
      await this.load();
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not reset the password.'), 'OK', {
        duration: 5000,
      });
    }
  }

  protected async resetMfa(user: SessionUser): Promise<void> {
    try {
      await firstValueFrom(this.api.resetMfa(user.id));
      this.snack.open(`MFA reset for ${user.email}; their sessions were signed out.`, 'OK', {
        duration: 5000,
      });
      await this.load();
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not reset MFA.'), 'OK', { duration: 5000 });
    }
  }

  private messageFor(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message = (err.error as { message?: string } | null)?.message;
      if (typeof message === 'string') return message;
    }
    return fallback;
  }
}
