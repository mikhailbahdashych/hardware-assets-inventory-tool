import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateEmployeeRequest,
  EmployeeDto,
  Paginated,
  UpdateEmployeeRequest,
} from '@inventory/shared';

@Injectable({ providedIn: 'root' })
export class EmployeesApi {
  private readonly http = inject(HttpClient);

  list(
    page: number,
    pageSize: number,
    search?: string,
    isActive?: boolean,
  ): Observable<Paginated<EmployeeDto>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (search) params = params.set('search', search);
    if (isActive !== undefined) params = params.set('isActive', isActive);
    return this.http.get<Paginated<EmployeeDto>>('/api/v1/employees', { params });
  }

  create(body: CreateEmployeeRequest): Observable<EmployeeDto> {
    return this.http.post<EmployeeDto>('/api/v1/employees', body);
  }

  update(id: string, body: UpdateEmployeeRequest): Observable<EmployeeDto> {
    return this.http.patch<EmployeeDto>(`/api/v1/employees/${id}`, body);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/employees/${id}`);
  }
}
