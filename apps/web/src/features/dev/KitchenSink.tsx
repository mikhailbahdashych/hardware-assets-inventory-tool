import { useEffect, useState } from 'react';
import {
  ASSET_STATUSES,
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  AUDIT_TYPES,
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  ROLES,
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SEMANTIC_COLORS,
  type Role,
} from '@inventory/shared';
import {
  Avatar,
  BackLink,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dropdown,
  Dropzone,
  EmptyState,
  Field,
  FilterPills,
  Icon,
  IconButton,
  Input,
  Kbd,
  KeyValueRow,
  Modal,
  PageHeader,
  Pill,
  RadioCard,
  SearchInput,
  SegmentedControl,
  Spinner,
  Menu,
  Tabs,
  Textarea,
  ToggleSwitch,
  type IconName,
} from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useToast } from '@/providers/ToastProvider';
import type { RowProps, SectionProps } from './types/kitchenSink';

const DEMO_ROWS = [
  { tag: 'AST-0142', name: 'MacBook Pro 14" M3', serial: 'C02XK1AZQ6L7', status: 'assigned' },
  { tag: 'AST-0177', name: 'Dell UltraSharp U2723QE', serial: 'CN0J2Y8', status: 'available' },
  { tag: 'AST-0089', name: 'MacBook Air M2', serial: 'C02FL9QXQ6L4', status: 'in_repair' },
] as const;

function Section({ title, children }: SectionProps) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: RowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

/** Every icon the design ships, straight off `Icon`'s own union. */
const ICON_NAMES: IconName[] = [
  'cube',
  'cubeSimple',
  'grid',
  'users',
  'user',
  'shieldCheck',
  'shield',
  'gear',
  'search',
  'sun',
  'moon',
  'plus',
  'upload',
  'file',
  'pencil',
  'chevronLeft',
  'chevronDown',
  'check',
  'activity',
  'logOut',
  'x',
];

/** The surface tokens, in the order tokens.css declares them. */
const SURFACE_TOKENS = [
  'bg',
  'surface',
  'side',
  'border',
  'text',
  'muted',
  'faint',
  'hover',
  'thead',
  'accent',
] as const;

/**
 * The type scale, as the app actually uses it. Sizes are not free choices —
 * a new screen picks the row that matches its job rather than a new number.
 */
const TYPE_SCALE = [
  { size: 20, weight: 600, use: 'KPI counts' },
  { size: 18, weight: 600, use: 'Detail page headings' },
  { size: 17, weight: 600, use: 'Modal titles' },
  { size: 14, weight: 600, use: 'Card titles' },
  { size: 13.5, weight: 500, use: 'Table cells, body copy' },
  { size: 13, weight: 600, use: 'Buttons, section labels' },
  { size: 12.5, weight: 400, use: 'Inputs, dropdowns' },
  { size: 12, weight: 500, use: 'Field labels, pills' },
  { size: 11.5, weight: 400, use: 'Hints, footnotes' },
  { size: 11, weight: 500, use: 'Table headers, kbd' },
] as const;

/** What each `--token` actually resolves to right now, straight from the CSSOM. */
function readTokens(names: readonly string[]): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    names.map((name) => [name, computed.getPropertyValue(`--${name}`).trim()]),
  );
}

/**
 * The resolved value of each token, so a swatch can print the colour it is.
 *
 * These live in the CSSOM, not in React, and they change when `ThemeProvider`
 * flips `data-theme` on `<html>` — which it does in an effect, *after* the
 * render that toggled it. Deriving them during a render would therefore show
 * the previous theme's palette, one toggle behind. So this subscribes to the
 * attribute instead: an external system, read when it says it changed.
 */
function useTokenValues(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>(() => readTokens(names));

  useEffect(() => {
    const observer = new MutationObserver(() => setValues(readTokens(names)));
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [names]);

  return values;
}

/**
 * The design system, rendered. This page **is** the visual specification: the
 * tokens, the type scale, the icon inventory and every primitive in every state
 * it ships with, in both themes and both densities.
 *
 * Dev-only (`import.meta.env.DEV` in routes.tsx), so it costs a production
 * build nothing. Open it beside whatever you are building — if a screen needs a
 * colour, a size or a control that is not on this page, that is the thing to
 * question first.
 */
export function KitchenSink() {
  const { theme, density, toggleTheme, setDensity } = useTheme();
  const { show } = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState('activity');
  const [role, setRole] = useState<Role>('viewer');
  const [toggles, setToggles] = useState({ warranty: true, digest: false });
  const [modal, setModal] = useState<'none' | 'plain' | 'scroll'>('none');
  const [category, setCategory] = useState('laptops');
  const [condition, setCondition] = useState('good');
  const tokens = useTokenValues(SURFACE_TOKENS);

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: '0 auto',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}
    >
      <PageHeader
        title="Kitchen sink"
        subtitle="The design system — tokens, type, icons and every primitive, in both themes and densities"
      >
        <SegmentedControl
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          value={density}
          onChange={setDensity}
        />
        <IconButton
          icon={theme === 'light' ? 'moon' : 'sun'}
          label="Toggle theme"
          bordered
          onClick={toggleTheme}
        />
      </PageHeader>

      <Section title="Surface tokens">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {SURFACE_TOKENS.map((name) => (
            <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div
                style={{
                  height: 44,
                  borderRadius: 6,
                  background: `var(--${name})`,
                  border: '1px solid var(--border)',
                }}
              />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>--{name}</code>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>{tokens[name]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Semantic colors">
        {/* Every status, role and log type resolves to one of these six. A new
            state picks one; it never introduces a seventh colour. */}
        <Row>
          {SEMANTIC_COLORS.map((sv) => (
            <Pill key={sv} sv={sv} dot>
              {sv}
            </Pill>
          ))}
        </Row>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
          {SEMANTIC_COLORS.map((sv) => (
            <div key={sv} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div
                style={{
                  height: 34,
                  borderRadius: 6,
                  background: `var(--${sv}-bg)`,
                  color: `var(--${sv})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Aa
              </div>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                --{sv} / --{sv}-bg
              </code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        {/* Two families: Instrument Sans for UI, JetBrains Mono for anything a
            person might copy — tags, serials, hostnames, timestamps. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TYPE_SCALE.map((step) => (
            <div
              key={`${step.size}-${step.weight}`}
              style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}
            >
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--faint)',
                  width: 92,
                  flex: 'none',
                }}
              >
                {step.size}px / {step.weight}
              </code>
              <span style={{ fontSize: step.size, fontWeight: step.weight }}>
                The quick brown fox
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{step.use}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--faint)',
                width: 92,
                flex: 'none',
              }}
            >
              --font-mono
            </code>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              AST-0142 · C02XK1AZQ6L7
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              Identifiers only — tags, serials, hostnames, log times
            </span>
          </div>
        </div>
      </Section>

      <Section title="Icons">
        {/* The whole inventory. Feather-style, stroke 1.7 — add new ones here in
            the same hand rather than reaching for an icon library. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 12 }}>
          {ICON_NAMES.map((name) => (
            <div
              key={name}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '10px 4px',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              <Icon name={name} size={17} />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <Row>
          <Button icon="plus">New asset</Button>
          <Button variant="ghost" icon="upload">
            Import CSV
          </Button>
          <Button variant="ghost" icon="pencil">
            Customize widgets
          </Button>
          <Button variant="danger">Delete…</Button>
          <Button size="sm">Small</Button>
          <Button variant="ghost" size="sm">
            Small ghost
          </Button>
          <Button disabled>Disabled</Button>
          <IconButton icon="search" label="Search" />
          <IconButton icon="logOut" label="Sign out" />
          <IconButton icon="x" label="Close" size={26} />
          <Spinner />
        </Row>
      </Section>

      <Section title="Pills">
        <Row>
          {ASSET_STATUSES.map((status) => (
            <Pill key={status} sv={ASSET_STATUS_COLORS[status]} dot>
              {ASSET_STATUS_LABELS[status]}
            </Pill>
          ))}
        </Row>
        <Row>
          {ROLES.map((r) => (
            <Pill key={r} sv={ROLE_COLORS[r]}>
              {ROLE_LABELS[r]}
            </Pill>
          ))}
          {AUDIT_TYPES.map((t) => (
            <Pill key={t} sv={AUDIT_TYPE_COLORS[t]} size="sm">
              {AUDIT_TYPE_LABELS[t]}
            </Pill>
          ))}
          <Pill sv="err" strong>
            27 days
          </Pill>
          <Pill sv="warn" strong>
            61 days
          </Pill>
        </Row>
      </Section>

      <Section title="Avatars">
        <Row>
          <Avatar name="Maya Lindqvist" colorKey="maya" size={24} />
          <Avatar name="Daniel Okafor" colorKey="daniel" size={26} />
          <Avatar name="Liam O'Connor" colorKey="liam" size={30} />
          <Avatar name="Tomasz Kowalski" colorKey="tomasz" size={44} />
        </Row>
      </Section>

      <Section title="Filters & tabs">
        <FilterPills
          options={[
            { value: 'all', label: 'All', count: 13 },
            { value: 'available', label: 'Available', count: 2 },
            { value: 'assigned', label: 'Assigned', count: 7 },
            { value: 'in_repair', label: 'In repair', count: 1 },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <Tabs
          tabs={[
            { value: 'activity', label: 'Activity log' },
            { value: 'settings', label: 'Settings' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Row>
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, tag or serial…"
          />
          <Kbd>⌘K</Kbd>
          <Kbd>esc</Kbd>
          <Menu
            label="Row actions"
            items={[
              { label: 'Resend invitation', onSelect: () => {} },
              { label: 'Change role', onSelect: () => {} },
              { label: 'Remove from workspace', onSelect: () => {}, danger: true },
            ]}
          />
        </Row>
      </Section>

      <Section title="Table">
        <DataTable
          columns={[
            {
              header: 'Asset',
              width: 'minmax(210px,1.6fr)',
              render: (row: (typeof DEMO_ROWS)[number]) => (
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{row.name}</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11.5,
                      color: 'var(--muted)',
                      marginTop: 1,
                    }}
                  >
                    {row.tag}
                  </div>
                </div>
              ),
            },
            {
              header: 'Serial',
              width: '130px',
              render: (row) => (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{row.serial}</span>
              ),
            },
            {
              header: 'Status',
              width: '110px',
              render: (row) => (
                <Pill sv={ASSET_STATUS_COLORS[row.status]} dot>
                  {ASSET_STATUS_LABELS[row.status]}
                </Pill>
              ),
            },
          ]}
          rows={[...DEMO_ROWS]}
          rowKey={(row) => row.tag}
          onRowClick={(row) => show(`Would open ${row.tag}`, 'info')}
          footer="3 assets"
        />
        <Card padding={false}>
          <EmptyState>No assets match the current filter.</EmptyState>
        </Card>
      </Section>

      <Section title="Forms">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px 16px',
            maxWidth: 560,
          }}
        >
          <Field label="Name" required>
            {(id) => <Input id={id} placeholder='MacBook Pro 14" M3' />}
          </Field>
          <Field label="Asset tag" hint="Auto-generated — editable">
            {(id) => <Input id={id} mono placeholder="AST-0224" />}
          </Field>
          <Field label="Category">
            {(id) => (
              <Dropdown
                id={id}
                value={category}
                onChange={setCategory}
                options={[
                  { value: 'laptops', label: 'Laptops' },
                  { value: 'monitors', label: 'Monitors' },
                ]}
              />
            )}
          </Field>
          <Field label="Purchase date" error="Enter a valid date">
            {(id) => <Input id={id} placeholder="2026-08-16" />}
          </Field>
        </div>
        <div style={{ maxWidth: 560 }}>
          <Field label="Notes">{(id) => <Textarea id={id} placeholder="Optional notes…" />}</Field>
        </div>
        <Row>
          <Checkbox label="Create another" defaultChecked />
          <Checkbox label="Email confirmation to holder" />
        </Row>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 440 }}>
          {ROLES.map((r) => (
            <RadioCard
              key={r}
              name="ks-role"
              value={r}
              checked={role === r}
              onChange={setRole}
              title={ROLE_LABELS[r]}
              description={ROLE_DESCRIPTIONS[r]}
            />
          ))}
        </div>
        <Row>
          <ToggleSwitch
            checked={toggles.warranty}
            onChange={(v) => setToggles((t) => ({ ...t, warranty: v }))}
            label="Warranty alerts"
          />
          <span style={{ fontSize: 12.5 }}>Warranty alerts</span>
          <ToggleSwitch
            checked={toggles.digest}
            onChange={(v) => setToggles((t) => ({ ...t, digest: v }))}
            label="Weekly digest"
          />
          <span style={{ fontSize: 12.5 }}>Weekly digest</span>
        </Row>
        <div style={{ maxWidth: 560 }}>
          <Dropzone
            onFile={(file) => show(`${file.name} selected`, 'ok')}
            accept=".csv"
            label="Drop your CSV here or"
            inputLabel="Demo CSV file"
            hint="Up to 5,000 rows per import · you'll review column mapping next"
          />
        </div>
      </Section>

      <Section title="Disabled and error states">
        {/* The states a screen actually hits. A disabled control keeps its
            reason visible next to it rather than vanishing — see how the
            Settings page handles an instance with no SMTP. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '12px 16px',
            maxWidth: 840,
          }}
        >
          <Field label="Disabled input">
            {(id) => <Input id={id} value="AST-0142" disabled />}
          </Field>
          <Field label="Disabled dropdown">
            {(id) => (
              <Dropdown
                id={id}
                disabled
                value="laptops"
                onChange={() => {}}
                options={[{ value: 'laptops', label: 'Laptops' }]}
              />
            )}
          </Field>
          <Field label="Input with an error" error="Enter a valid serial number">
            {(id) => <Input id={id} value="???" onChange={() => {}} />}
          </Field>
        </div>
        <Row>
          <Checkbox label="Disabled checkbox" disabled />
          <ToggleSwitch checked={false} onChange={() => {}} label="Disabled switch" disabled />
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            SMTP is not configured on this instance
          </span>
        </Row>
      </Section>

      <Section title="Cards">
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}
        >
          <Card title="Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
              <KeyValueRow k="Category">Laptops</KeyValueRow>
              <KeyValueRow k="Serial number">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>C02XK1AZQ6L7</span>
              </KeyValueRow>
              <KeyValueRow k="Purchased">Mar 2023</KeyValueRow>
              <KeyValueRow k="Purchase price">€2,340</KeyValueRow>
            </div>
          </Card>
          <Card title="Navigation">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <BackLink to="/kitchen-sink">Assets</BackLink>
              <a href="#top">Audit log →</a>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Overlays">
        <Row>
          <Button variant="ghost" onClick={() => setModal('plain')}>
            Open modal
          </Button>
          <Button variant="ghost" onClick={() => setModal('scroll')}>
            Open scrollable modal
          </Button>
          <Button variant="ghost" onClick={() => show('Asset checked in', 'ok')}>
            Toast ok
          </Button>
          <Button variant="ghost" onClick={() => show('Something went wrong', 'err')}>
            Toast error
          </Button>
        </Row>
      </Section>

      {modal === 'plain' && (
        <Modal
          title="Check in asset"
          subtitle='AST-0142 · MacBook Pro 14" M3'
          width={460}
          topOffset="10vh"
          onClose={() => setModal('none')}
          footer={
            <>
              <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>* Required</span>
              <Button variant="ghost" onClick={() => setModal('none')}>
                Cancel
              </Button>
              <Button onClick={() => setModal('none')}>Check in asset</Button>
            </>
          }
        >
          <Field label="Return date" required>
            {(id) => <Input id={id} placeholder="Aug 16, 2026" />}
          </Field>
          <Field label="Condition">
            {(id) => (
              <Dropdown
                id={id}
                value={condition}
                onChange={setCondition}
                options={[
                  { value: 'good', label: 'Good' },
                  { value: 'needs_repair', label: 'Needs repair' },
                  { value: 'damaged', label: 'Damaged' },
                ]}
              />
            )}
          </Field>
        </Modal>
      )}

      {modal === 'scroll' && (
        <Modal
          title="New asset"
          subtitle="Add a device to the inventory"
          width={560}
          topOffset="6vh"
          maxHeight="86vh"
          onClose={() => setModal('none')}
          footer={
            <>
              <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>* Required</span>
              <Button variant="ghost" onClick={() => setModal('none')}>
                Cancel
              </Button>
              <Button onClick={() => setModal('none')}>Create asset</Button>
            </>
          }
        >
          {Array.from({ length: 14 }, (_, i) => (
            <Field key={i} label={`Field ${i + 1}`}>
              {(id) => <Input id={id} />}
            </Field>
          ))}
        </Modal>
      )}
    </div>
  );
}
