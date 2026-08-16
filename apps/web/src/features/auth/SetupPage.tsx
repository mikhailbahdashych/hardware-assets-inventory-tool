import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSetup } from '../../api/mutations';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import { fieldErrors } from './formErrors';
import styles from './Auth.module.css';

/**
 * First-run setup. Not part of the design handoff — self-hosting needs a way
 * to create the organization and its first admin — so it reuses the login
 * screen's layout exactly.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const setup = useSetup();
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const errors = fieldErrors(setup.error);

  return (
    <AuthLayout title="Set up Inventory" subtitle="Create your organization and its first admin.">
      <form
        style={{ display: 'contents' }}
        onSubmit={(event) => {
          event.preventDefault();
          setup.mutate(
            { orgName, name, email, password },
            { onSuccess: () => navigate('/dashboard') },
          );
        }}
      >
        <FormError error={setup.error} />
        <AuthField
          label="Organization name"
          value={orgName}
          onChange={setOrgName}
          placeholder="Acme Corp"
          autoFocus
          error={errors.orgName}
        />
        <AuthField
          label="Your name"
          value={name}
          onChange={setName}
          placeholder="Tomasz Kowalski"
          autoComplete="name"
          error={errors.name}
        />
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@acme.io"
          autoComplete="username"
          error={errors.email}
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="At least 10 characters"
          autoComplete="new-password"
          error={errors.password}
          hint="You will be signed in as an admin."
        />
        <button type="submit" className={styles.submit} disabled={setup.isPending}>
          {setup.isPending ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </AuthLayout>
  );
}
