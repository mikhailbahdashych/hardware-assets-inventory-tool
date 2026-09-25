import { PASSWORD_HINT } from '@inventory/shared';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { fieldErrors } from '@/api/formErrors';
import { useAcceptInvite } from '@/api/mutations';
import { useInvite } from '@/api/queries';
import { ErrorState, Spinner } from '@/components/ui';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import styles from './Auth.module.css';

/** The way out of a screen that cannot draw itself, on either dead end. */
function BackToSignIn() {
  return (
    <div className={styles.backLink}>
      <Link to="/login">Back to sign in</Link>
    </div>
  );
}

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

  /** A link with nothing to look up: no request was made, so nothing answered. */
  if (!token) {
    return (
      <AuthLayout title="Invitation link" below={<BackToSignIn />}>
        <div className={styles.error}>
          This invitation link is missing its token. Ask an admin for a new one.
        </div>
      </AuthLayout>
    );
  }

  /**
   * The lookup answered, and not with an invitation. **Which refusal it was is
   * the server's to say**: "This link is invalid or has expired." is its own
   * sentence for a token it rejected, and reporting a database that fell over
   * in those same words would send somebody off to mint a link that would fail
   * exactly as hard. The panel quotes whatever came back, and the retry is
   * real — an expired token simply expires again.
   */
  if (invite.isError) {
    return (
      <AuthLayout title="Invitation link" below={<BackToSignIn />}>
        <ErrorState error={invite.error} onRetry={() => void invite.refetch()}>
          This invitation could not be opened.
        </ErrorState>
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
      // The label rather than the id, and it arrives with the lookup: this
      // screen has no session, so it cannot read /roles to find out what a
      // workspace called the role it is inviting somebody into.
      subtitle={`You've been invited with the ${invite.data.roleLabel} role.`}
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
          placeholder={PASSWORD_HINT}
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
