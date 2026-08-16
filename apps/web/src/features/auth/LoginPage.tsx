import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLogin } from '../../api/mutations';
import { useMeta } from '../../api/queries';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import { fieldErrors } from './formErrors';
import styles from './Auth.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const { data: meta } = useMeta();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const errors = fieldErrors(login.error);

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
          login.mutate({ email, password }, { onSuccess: () => navigate('/dashboard') });
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
