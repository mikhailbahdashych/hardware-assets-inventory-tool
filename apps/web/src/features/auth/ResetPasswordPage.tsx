import { PASSWORD_HINT } from '@inventory/shared';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { fieldErrors } from '@/api/formErrors';
import { useResetPassword } from '@/api/mutations';
import { orgMeta, useMeta } from '@/api/queries';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import { MfaChallenge } from './LoginPage';
import styles from './Auth.module.css';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // No `?token=` is a real state: the screen then says the link is invalid.
  const token = searchParams.get('token') ?? '';
  const reset = useResetPassword();
  const [newPassword, setNewPassword] = useState('');
  // Both route sets that draw this page exist only once /meta has said the
  // instance is set up, so the organization is known.
  const org = orgMeta(useMeta().data);
  /**
   * Set when the password is saved and the account has an authenticator: the
   * link proved an admin vouched for its holder, not that they hold the phone.
   */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const errors = fieldErrors(reset.error);

  if (challengeToken) {
    return <MfaChallenge challengeToken={challengeToken} orgName={org.orgName} />;
  }

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
          reset.mutate(
            { token, newPassword },
            {
              onSuccess: (result) => {
                if ('mfaRequired' in result) setChallengeToken(result.challengeToken);
                else navigate('/dashboard');
              },
            },
          );
        }}
      >
        {/* A 422 that names the field is said under it; the banner is for the
            refusals that belong to the form as a whole — an expired link. */}
        <FormError error={!errors.newPassword ? reset.error : null} />
        <AuthField
          label="New password"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          placeholder={PASSWORD_HINT}
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
