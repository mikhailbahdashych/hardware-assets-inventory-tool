import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  MfaLoginRequest,
  MfaSetupResponse,
  MfaVerifyRequest,
  MfaVerifyResponse,
  SessionUser,
  SetupRequest,
} from '@inventory/shared';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  setupStatus(): Observable<{ setupRequired: boolean }> {
    return this.http.get<{ setupRequired: boolean }>('/api/v1/auth/setup-status');
  }

  setup(body: SetupRequest): Observable<SessionUser> {
    return this.http.post<SessionUser>('/api/v1/auth/setup', body);
  }

  login(body: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>('/api/v1/auth/login', body);
  }

  loginMfa(body: MfaLoginRequest): Observable<SessionUser> {
    return this.http.post<SessionUser>('/api/v1/auth/login/mfa', body);
  }

  mfaSetup(): Observable<MfaSetupResponse> {
    return this.http.post<MfaSetupResponse>('/api/v1/auth/mfa/setup', {});
  }

  mfaVerify(body: MfaVerifyRequest): Observable<MfaVerifyResponse> {
    return this.http.post<MfaVerifyResponse>('/api/v1/auth/mfa/verify', body);
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
