import { useState } from 'react';
import { AuthLayout } from './AuthLayout';
import type { RecoveryCodesScreenProps } from './types/recoveryCodesScreen';
import styles from './Auth.module.css';

/**
 * Shown once, and it says so. The codes are stored as hashes, so this render is
 * the only moment they exist in readable form anywhere — which is exactly why
 * the way out of this screen is a button that admits you have kept them.
 *
 * Both places a set is ever issued come here: finishing enrolment, and a
 * two-factor sign-in that found none left and minted ten. The copy is the same
 * because the advice is the same; only `reason` differs, and only because a set
 * nobody asked for has to explain itself.
 */
export function RecoveryCodesScreen({ codes, reason, onDone }: RecoveryCodesScreenProps) {
  const [kept, setKept] = useState(false);

  return (
    <AuthLayout title="Save your recovery codes" subtitle="The only way in if you lose your phone">
      {reason !== undefined && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>{reason}</p>
      )}
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
        Each code works once, instead of a code from your app. Store them somewhere other than the
        phone holding your authenticator. <strong>They are not shown again.</strong>
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          padding: '10px 12px',
          background: 'var(--hover)',
          borderRadius: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
        }}
      >
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
        <input type="checkbox" checked={kept} onChange={(event) => setKept(event.target.checked)} />
        I have saved these somewhere safe
      </label>

      <button type="button" className={styles.submit} disabled={!kept} onClick={onDone}>
        Continue to Inventory
      </button>
    </AuthLayout>
  );
}
