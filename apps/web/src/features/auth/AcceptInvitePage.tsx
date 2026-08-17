import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useAcceptInvite } from '@/api/mutations';
import { useInvite } from '@/api/queries';
import { Spinner } from '@/components/ui';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import styles from './Auth.module.css';

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // No `?token=` is a real state: the screen then says the link is invalid.
  const token = searchParams.get('token') ?? '';
  const invite = useInvite(token);
  const accept = useAcceptInvite();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const errors = fieldErrors(accept.error);

  if (!token || invite.isError) {
    return (
      <AuthLayout
        title="Invitation link"
        below={
          <div className={styles.backLink}>
            <Link to="/login">Back to sign in</Link>
          </div>
        }
      >
        <div className={styles.error}>
          This invitation is invalid or has expired. Ask an admin to send you a new one.
        </div>
      </AuthLayout>
    );
  }

  if (invite.isPending) {
    return (
      <AuthLayout title="Invitation link">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <Spinner size={18} />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`Join ${invite.data.orgName}`}
      subtitle={`You've been invited as a ${ROLE_LABELS[invite.data.role]} — ${ROLE_DESCRIPTIONS[
        invite.data.role
      ].toLowerCase()}.`}
    >
      <form
        style={{ display: 'contents' }}
        onSubmit={(event) => {
          event.preventDefault();
          accept.mutate({ token, name, password }, { onSuccess: () => navigate('/dashboard') });
        }}
      >
        <FormError error={accept.error} />
        <AuthField label="Email" value={invite.data.email} onChange={() => {}} />
        <AuthField
          label="Your name"
          value={name}
          onChange={setName}
          placeholder="Daniel Okafor"
          autoComplete="name"
          autoFocus
          error={errors.name}
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="At least 10 characters"
          autoComplete="new-password"
          error={errors.password}
        />
        <button type="submit" className={styles.submit} disabled={accept.isPending}>
          {accept.isPending ? 'Joining…' : 'Join workspace'}
        </button>
      </form>
    </AuthLayout>
  );
}
