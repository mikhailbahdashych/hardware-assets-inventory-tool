import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-dashboard-page',
  imports: [MatCardModule, MatIconModule],
  template: `
    <mat-card appearance="outlined" class="welcome">
      <mat-card-content>
        <mat-icon class="big">inventory_2</mat-icon>
        <h1>Welcome, {{ user()?.displayName }}</h1>
        <p>
          Your inventory is empty so far. Asset management, employees, and assignments arrive in the
          next phases — this dashboard will show live counts and recent activity.
        </p>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .welcome {
      max-width: 560px;
      margin: 48px auto;
      text-align: center;
    }
    .big {
      font-size: 56px;
      width: 56px;
      height: 56px;
      opacity: 0.5;
    }
    h1 {
      font-size: 1.4rem;
      margin: 12px 0 4px;
    }
    p {
      opacity: 0.75;
    }
  `,
})
export class DashboardPage {
  protected readonly user = inject(AuthStore).user;
}
