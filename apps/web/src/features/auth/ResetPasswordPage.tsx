import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { fieldErrors } from '@/api/formErrors';
import { useResetPassword } from '@/api/mutations';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import styles from './Auth.module.css';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const reset = useResetPassword();
  const [newPassword, setNewPassword] = useState('');
  const errors = fieldErrors(reset.error);

  if (!token) {
    return (
      <AuthLayout
        title="Reset your password"
        below={
          <div className={styles.backLink}>
            <Link to="/login">Back to sign in</Link>
          </div>
        }
      >
        <div className={styles.error}>
          This reset link is missing its token. Request a new link and try again.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Signing you in once it's saved.">
      <form
        style={{ display: 'contents' }}
        onSubmit={(event) => {
          event.preventDefault();
          reset.mutate({ token, newPassword }, { onSuccess: () => navigate('/dashboard') });
        }}
      >
        <FormError error={reset.error} />
        <AuthField
          label="New password"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          placeholder="At least 10 characters"
          autoComplete="new-password"
          autoFocus
          error={errors.newPassword}
          hint="Your other sessions will be signed out."
        />
        <button type="submit" className={styles.submit} disabled={reset.isPending}>
          {reset.isPending ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthLayout>
  );
}
