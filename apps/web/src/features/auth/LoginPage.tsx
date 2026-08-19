import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { fieldErrors } from '@/api/formErrors';
import { useLogin, useMfaVerify, useRefreshSession } from '@/api/mutations';
import { useMeta } from '@/api/queries';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import { RecoveryCodesScreen } from './RecoveryCodesScreen';
import type { MfaChallengeProps } from './types/loginPage';
import styles from './Auth.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const { data: meta } = useMeta();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /**
   * Set once the password is accepted and the account turns out to have an
   * authenticator. Its presence *is* the second step — the password fields are
   * gone by then, and there is nothing to go back to but reloading.
   */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const errors = fieldErrors(login.error);

  if (challengeToken) {
    return <MfaChallenge challengeToken={challengeToken} orgName={meta?.orgName} />;
  }

  return (
    <AuthLayout
      title="Sign in to Inventory"
      subtitle={
        meta?.orgName
          ? `Self-hosted hardware asset tracking for ${meta.orgName}`
          : 'Self-hosted hardware asset tracking'
      }
    >
      <form
        style={{ display: 'contents' }}
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate(
            { email, password },
            {
              onSuccess: (result) => {
                if ('mfaRequired' in result) setChallengeToken(result.challengeToken);
                else navigate('/dashboard');
              },
            },
          );
        }}
      >
        <FormError error={login.error} />
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@acme.io"
          autoComplete="username"
          autoFocus
          error={errors.email}
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="current-password"
          error={errors.password}
          trailing={
            <Link to="/forgot-password" style={{ fontSize: 12 }}>
              Forgot?
            </Link>
          }
        />
        <button type="submit" className={styles.submit} disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}

/**
 * The second step. One input takes either kind of code, because the server
 * decides which by what matches — asking somebody to pick "authenticator" or
 * "recovery" before typing is a choice they should not have to make.
 */
function MfaChallenge({ challengeToken, orgName }: MfaChallengeProps) {
  const navigate = useNavigate();
  const verify = useMfaVerify();
  const refreshSession = useRefreshSession();
  const [code, setCode] = useState('');
  /**
   * A set the server minted because this member had none left. Its presence is
   * a third step nobody asked for: the session already exists, but these codes
   * exist nowhere else, so the app waits behind them.
   */
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  if (recoveryCodes) {
    return (
      <RecoveryCodesScreen
        codes={recoveryCodes}
        reason="Your recovery codes were reset, so here is a new set."
        onDone={() => {
          void refreshSession();
          navigate('/dashboard');
        }}
      />
    );
  }

  return (
    <AuthLayout
      title="Two-factor authentication"
      subtitle={
        orgName ? `${orgName} requires a second factor` : 'Enter the code from your authenticator'
      }
    >
      <form
        style={{ display: 'contents' }}
        onSubmit={(event) => {
          event.preventDefault();
          verify.mutate(
            { challengeToken, code },
            {
              onSuccess: (result) => {
                if (result.recoveryCodes) setRecoveryCodes(result.recoveryCodes);
                else navigate('/dashboard');
              },
            },
          );
        }}
      >
        <FormError error={verify.error} />
        <AuthField
          label="Authentication code"
          value={code}
          onChange={setCode}
          placeholder="123456"
          // `one-time-code` is what lets a phone offer the code from the
          // notification; the field takes a recovery code just as happily.
          autoComplete="one-time-code"
          autoFocus
        />
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
          Enter the 6-digit code from your authenticator app, or one of your recovery codes.
        </p>
        <button type="submit" className={styles.submit} disabled={verify.isPending}>
          {verify.isPending ? 'Checking…' : 'Verify'}
        </button>
      </form>
    </AuthLayout>
  );
}
