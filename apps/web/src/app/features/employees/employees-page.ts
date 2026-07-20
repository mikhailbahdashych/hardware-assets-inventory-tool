import { Component, computed, inject, OnInit, signal } from '@angular/core';
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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { EmployeeDto } from '@inventory/shared';
import { AuthStore } from '../../core/auth/auth.store';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { EmployeesApi } from './employees.api';
import { EmployeeDialog, EmployeeDialogData, EmployeeDialogResult } from './employee-dialog';

const BASE_COLUMNS = ['name', 'email', 'employeeNumber', 'department', 'title', 'status'];

@Component({
  selector: 'app-employees-page',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTableModule,
  ],
  templateUrl: './employees-page.html',
  styleUrl: './employees-page.scss',
})
export class EmployeesPage implements OnInit {
  private readonly api = inject(EmployeesApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly searchInput = new Subject<string>();

  protected readonly store = inject(AuthStore);
  protected readonly columns = computed(() =>
    this.store.isManagerUp() ? [...BASE_COLUMNS, 'actions'] : BASE_COLUMNS,
  );
  protected readonly employees = signal<EmployeeDto[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly busy = signal(false);
  protected readonly activeOnly = signal(false);
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

  protected onActiveOnly(checked: boolean): void {
    this.activeOnly.set(checked);
    this.page.set(1);
    void this.load();
  }

  protected onPage(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    try {
      const result = await firstValueFrom(
        this.api.list(
          this.page(),
          this.pageSize(),
          this.search || undefined,
          this.activeOnly() ? true : undefined,
        ),
      );
      this.employees.set(result.items);
      this.total.set(result.total);
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not load employees.'), 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async createEmployee(): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open<EmployeeDialog, EmployeeDialogData, EmployeeDialogResult>(EmployeeDialog, {
          data: { mode: 'create' },
        })
        .afterClosed(),
    );
    if (!result) return;
    try {
      await firstValueFrom(this.api.create(result));
      await this.load();
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not create the employee.'), 'OK', {
        duration: 5000,
      });
    }
  }

  protected async editEmployee(employee: EmployeeDto): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open<EmployeeDialog, EmployeeDialogData, EmployeeDialogResult>(EmployeeDialog, {
          data: { mode: 'edit', employee },
        })
        .afterClosed(),
    );
    if (!result) return;
    try {
      await firstValueFrom(this.api.update(employee.id, result));
      await this.load();
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not update the employee.'), 'OK', {
        duration: 5000,
      });
    }
  }

  protected async deleteEmployee(employee: EmployeeDto): Promise<void> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: 'Delete employee',
            message: `Permanently delete ${employee.firstName} ${employee.lastName}? Employees with assignment history cannot be deleted — deactivate them instead.`,
            confirmLabel: 'Delete',
            destructive: true,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.delete(employee.id));
      this.snack.open('Employee deleted.', 'OK', { duration: 4000 });
      await this.load();
    } catch (err) {
      this.snack.open(this.messageFor(err, 'Could not delete the employee.'), 'OK', {
        duration: 6000,
      });
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
