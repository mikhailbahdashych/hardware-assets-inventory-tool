import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { fieldErrors } from '@/api/formErrors';
import { useLogout, useMfaConfirm, useMfaEnroll } from '@/api/mutations';
import { AuthField, AuthLayout, FormError } from './AuthLayout';
import { RecoveryCodesScreen } from './RecoveryCodesScreen';
import type { MfaEnrollPageProps } from './types/mfaEnrollPage';
import styles from './Auth.module.css';

/**
 * The screen a member cannot get past until they have an authenticator, shown
 * when the workspace requires a second factor and they have not set one up.
 *
 * Three states in one page, because they are one task: scan, confirm, then
 * write the recovery codes down. The last is the only time those codes exist —
 * they are stored hashed, so nothing can show them again.
 */
export function MfaEnrollPage({ member }: MfaEnrollPageProps) {
  const enroll = useMfaEnroll();
  const confirm = useMfaConfirm();
  const logout = useLogout();
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const { mutate: begin } = enroll;
  useEffect(() => {
    // One secret per visit to this screen. Re-entering replaces an abandoned
    // one, which is the API's rule too — a half-scanned QR should not haunt
    // somebody's next attempt.
    begin();
  }, [begin]);

  const otpauthUri = enroll.data?.otpauthUri;
  useEffect(() => {
    if (!otpauthUri) return;
    let cancelled = false;
    // Rendered in the browser: the URI contains the secret, and an image
    // request would put it in a server log.
    void QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  if (recoveryCodes) {
    // A reload is what re-asks /auth/me, and the gate in routes.tsx opens
    // because the enrolment is now confirmed.
    return (
      <RecoveryCodesScreen
        codes={recoveryCodes}
        onDone={() => window.location.assign('/dashboard')}
      />
    );
  }

  const errors = fieldErrors(confirm.error);

  return (
    <AuthLayout
      title="Set up two-factor authentication"
      subtitle={`This workspace requires it · signed in as ${member.email}`}
    >
      <form
        style={{ display: 'contents' }}
        onSubmit={(event) => {
          event.preventDefault();
          confirm.mutate(
            { code },
            { onSuccess: ({ recoveryCodes: codes }) => setRecoveryCodes(codes) },
          );
        }}
      >
        <FormError error={enroll.error} />
        <FormError error={confirm.error} />

        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
          Scan this with an authenticator app — 1Password, Bitwarden, Google Authenticator, Aegis or
          any other.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {qr ? (
            <img
              src={qr}
              alt="QR code for your authenticator app"
              width={200}
              height={200}
              // A white plate under it: a QR inverted by dark mode does not scan.
              style={{ background: '#fff', borderRadius: 8, padding: 8 }}
            />
          ) : (
            <div style={{ height: 216 }} />
          )}
        </div>

        {enroll.data && (
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>
              Or enter this key by hand
            </div>
            <code
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                wordBreak: 'break-all',
                padding: '8px 10px',
                background: 'var(--hover)',
                borderRadius: 6,
              }}
            >
              {enroll.data.secret}
            </code>
          </div>
        )}

        <AuthField
          label="Code from the app"
          value={code}
          onChange={setCode}
          placeholder="123456"
          autoComplete="one-time-code"
          error={errors.code}
        />
        <button
          type="submit"
          className={styles.submit}
          disabled={confirm.isPending || !enroll.data}
        >
          {confirm.isPending ? 'Checking…' : 'Confirm and finish'}
        </button>
        <button
          type="button"
          onClick={() => logout.mutate()}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--muted)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Sign out instead
        </button>
      </form>
    </AuthLayout>
  );
}
