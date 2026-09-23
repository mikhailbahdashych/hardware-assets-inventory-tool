import { useState, type FormEvent } from 'react';
import {
  API_SCOPE_DESCRIPTIONS,
  API_SCOPE_LABELS,
  API_SCOPES,
  TOKEN_TTL_LABELS,
  TOKEN_TTL_OPTIONS,
  type ApiScope,
  type TokenTtl,
} from '@inventory/shared';
import { fieldErrors } from '@/api/formErrors';
import { useCreateApiToken } from '@/api/mutations';
import { Button, Checkbox, Dropdown, Field, Input, Modal } from '@/components/ui';
import formStyles from '@/components/ui/FormModal.module.css';
import { CopyLinkModal } from '@/features/members/CopyLinkModal';
import type { ApiTokenFormModalProps } from './types/apiTokenFormModal';
import styles from './ApiTokens.module.css';

/**
 * Reading and changing, in that order: what a token may *read* is the half an
 * admin can hand out freely, and everything below the line changes the
 * inventory. The split comes off the scope's own verb, so a scope added to
 * `API_SCOPES` lands in the right band without this file being told.
 */
const BANDS = [
  { label: 'Reading', scopes: API_SCOPES.filter((scope) => scope.endsWith(':read')) },
  { label: 'Changing things', scopes: API_SCOPES.filter((scope) => !scope.endsWith(':read')) },
];

/** The ttl a token starts on: long enough to be useful, short enough to expire. */
const DEFAULT_TTL: TokenTtl = 90;

/**
 * Minting a token, and the one moment its raw value exists outside whatever
 * deployment is about to hold it — shown once through `CopyLinkModal`, the
 * same screen an invitation link and a set password end on, because the rule
 * is the same: the database keeps only a hash.
 */
export function ApiTokenFormModal({ onClose }: ApiTokenFormModalProps) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set());
  const [ttl, setTtl] = useState<TokenTtl>(DEFAULT_TTL);
  const [minted, setMinted] = useState<string | null>(null);

  const create = useCreateApiToken();
  const errors = fieldErrors(create.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      // In the order the vocabulary declares them, not the order they were
      // ticked — the same set means the same request.
      { name, scopes: API_SCOPES.filter((scope) => scopes.has(scope)), expiresInDays: ttl },
      { onSuccess: (result) => setMinted(result.token) },
    );
  }

  if (minted) {
    return (
      <CopyLinkModal
        title="Token created"
        subtitle={`${name} can now call the public API`}
        label="API token"
        url={minted}
        hint="It appears only here — the app keeps only a hash of it. Put it straight into the system that needs it; if it is lost, revoke the token and mint another."
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      title="New API token"
      subtitle="A credential for a system, not a person"
      width={520}
      topOffset="8vh"
      maxHeight="84vh"
      onClose={onClose}
      footer={
        <>
          <span className={formStyles.required}>* Required</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-api-token"
            // A token with no name is unidentifiable in the log, and one with
            // no scope can do nothing at all.
            disabled={create.isPending || name.trim() === '' || scopes.size === 0}
          >
            Create token
          </Button>
        </>
      }
    >
      <form id="new-api-token" className={formStyles.form} onSubmit={submit} noValidate>
        <Field
          label="Name"
          required
          hint="What holds it — “CI pipeline”, “Warehouse sync”"
          error={errors.name}
        >
          {(id) => (
            <Input
              id={id}
              value={name}
              placeholder="e.g. Provisioning bot"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field label="Scopes" required error={errors.scopes}>
          <div className={styles.bands}>
            {BANDS.map((band) => (
              <div key={band.label}>
                <div className={styles.bandLabel}>{band.label}</div>
                <div className={styles.scopeGrid}>
                  {band.scopes.map((scope) => (
                    <Checkbox
                      key={scope}
                      className={styles.scope}
                      checked={scopes.has(scope)}
                      onChange={() =>
                        setScopes((current) => {
                          const next = new Set(current);
                          if (!next.delete(scope)) next.add(scope);
                          return next;
                        })
                      }
                      label={
                        <span>
                          {API_SCOPE_LABELS[scope]}
                          <span className={styles.scopeHint}>{API_SCOPE_DESCRIPTIONS[scope]}</span>
                        </span>
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Field>

        <Field label="Expires" hint="A token that expires is one nobody has to remember to revoke">
          {(id) => (
            <Dropdown
              id={id}
              value={`${ttl}`}
              options={TOKEN_TTL_OPTIONS.map((days) => ({
                value: `${days}`,
                label: TOKEN_TTL_LABELS[`${days}`],
              }))}
              onChange={(value) => setTtl(readTtl(value))}
            />
          )}
        </Field>

        {create.error && !errors.name && !errors.scopes && (
          <div className={formStyles.formError}>{create.error.message}</div>
        )}
      </form>
    </Modal>
  );
}

/**
 * The dropdown speaks strings; the schema takes the number or the null. The
 * options come from `TOKEN_TTL_OPTIONS`, so a value from anywhere else is this
 * file having been edited wrongly rather than a state to fall back from.
 */
function readTtl(value: string): TokenTtl {
  const found = TOKEN_TTL_OPTIONS.find((days) => `${days}` === value);
  if (found === undefined) throw new Error(`"${value}" is not one of the offered token lifetimes.`);
  return found;
}
