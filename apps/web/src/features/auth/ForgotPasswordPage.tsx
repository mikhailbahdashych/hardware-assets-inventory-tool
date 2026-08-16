import { useState } from 'react';
import { Link } from 'react-router';
import { useForgotPassword } from '../../api/mutations';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import styles from './Auth.module.css';

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to choose a new password."
      below={
        <div className={styles.backLink}>
          <Link to="/login">Back to sign in</Link>
        </div>
      }
    >
      {forgot.isSuccess ? (
        <>
          <div className={styles.notice}>
            If an account exists for {email}, a reset link is on its way.
          </div>
          <div className={styles.hint}>
            No email arriving? This instance may not have SMTP configured — ask an admin to send you
            a reset link from the Members page.
          </div>
        </>
      ) : (
        <form
          style={{ display: 'contents' }}
          onSubmit={(event) => {
            event.preventDefault();
            forgot.mutate({ email });
          }}
        >
          <FormError error={forgot.error} />
          <AuthField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@acme.io"
            autoComplete="username"
            autoFocus
          />
          <button type="submit" className={styles.submit} disabled={forgot.isPending}>
            {forgot.isPending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
