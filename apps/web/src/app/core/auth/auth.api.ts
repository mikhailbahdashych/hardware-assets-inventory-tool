import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ChangePasswordRequest, LoginRequest, SessionUser, SetupRequest } from '@inventory/shared';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  setupStatus(): Observable<{ setupRequired: boolean }> {
    return this.http.get<{ setupRequired: boolean }>('/api/v1/auth/setup-status');
  }

  setup(body: SetupRequest): Observable<SessionUser> {
    return this.http.post<SessionUser>('/api/v1/auth/setup', body);
  }

  login(body: LoginRequest): Observable<SessionUser> {
    return this.http.post<SessionUser>('/api/v1/auth/login', body);
  }

  me(): Observable<SessionUser> {
    return this.http.get<SessionUser>('/api/v1/auth/me');
  }

  refresh(): Observable<SessionUser> {
    return this.http.post<SessionUser>('/api/v1/auth/refresh', {});
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/v1/auth/logout', {});
  }

  changePassword(body: ChangePasswordRequest): Observable<void> {
    return this.http.post<void>('/api/v1/auth/change-password', body);
  }
}
