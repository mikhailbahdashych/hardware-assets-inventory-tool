import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateUserRequest,
  CreateUserResponse,
  Paginated,
  ResetPasswordResponse,
  SessionUser,
  UpdateUserRequest,
} from '@inventory/shared';

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);

  list(page: number, pageSize: number, search?: string): Observable<Paginated<SessionUser>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (search) params = params.set('search', search);
    return this.http.get<Paginated<SessionUser>>('/api/v1/users', { params });
  }

  create(body: CreateUserRequest): Observable<CreateUserResponse> {
    return this.http.post<CreateUserResponse>('/api/v1/users', body);
  }

  update(id: string, body: UpdateUserRequest): Observable<SessionUser> {
    return this.http.patch<SessionUser>(`/api/v1/users/${id}`, body);
  }

  resetPassword(id: string): Observable<ResetPasswordResponse> {
    return this.http.post<ResetPasswordResponse>(`/api/v1/users/${id}/reset-password`, {});
  }

  resetMfa(id: string): Observable<void> {
    return this.http.post<void>(`/api/v1/users/${id}/mfa/reset`, {});
  }
}
