import { inject, Injectable } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { MFA_ENROLLMENT_REQUIRED_MESSAGE } from '@inventory/shared';
import { AuthApi } from '../auth/auth.api';
import { AuthStore } from '../auth/auth.store';

/** DI-scoped so tests get a fresh instance; shares one refresh across parallel 401s. */
@Injectable({ providedIn: 'root' })
export class RefreshCoordinator {
  inFlight: Promise<boolean> | null = null;
}

/** Endpoints whose 401s are final — retrying them via refresh would loop. */
const NO_RETRY = /\/api\/v1\/auth\/(login|refresh|logout|setup)(?=$|[/?])/;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(AuthApi);
  const store = inject(AuthStore);
  const coordinator = inject(RefreshCoordinator);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: unknown) => {
      // Instance-wide MFA enforcement (MFA_ENFORCE_ALL) surfaces as 403s the
      // route guards can't predict from the user object — route to enrollment.
      if (
        err instanceof HttpErrorResponse &&
        err.status === 403 &&
        (err.error as { message?: string } | null)?.message === MFA_ENROLLMENT_REQUIRED_MESSAGE
      ) {
        router.navigate(['/mfa-setup']).catch(() => undefined);
        return throwError(() => err);
      }

      const isFinal =
        !(err instanceof HttpErrorResponse) || err.status !== 401 || NO_RETRY.test(req.url);
      if (isFinal) return throwError(() => err);

      coordinator.inFlight ??= firstValueFrom(api.refresh())
        .then((user) => {
          store.applyUser(user);
          return true;
        })
        .catch(() => {
          store.clear();
          router.navigate(['/login']).catch(() => undefined);
          return false;
        })
        .finally(() => {
          coordinator.inFlight = null;
        });

      return from(coordinator.inFlight).pipe(
        switchMap((refreshed) => (refreshed ? next(req) : throwError(() => err))),
      );
    }),
  );
};
