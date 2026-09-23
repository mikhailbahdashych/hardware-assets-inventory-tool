import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { avatarColor } from '@/lib/avatar';
import { ToastProvider, useToast } from '@/providers/ToastProvider';
import { choose } from '@/test/dropdown';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { DataTable } from './DataTable';
import { Dropdown } from './Dropdown';
import { Field } from './Field';
import { FilterPills } from './FilterPills';
import { Input } from './Input';
import { Menu } from './Menu';
import { Modal } from './Modal';
import { Pagination } from './Pagination';
import { Pill } from './Pill';
import { RadioCard } from './RadioCard';
import { SearchInput } from './SearchInput';
import { SegmentedControl } from './SegmentedControl';
import { Tabs } from './Tabs';
import { ToggleSwitch } from './ToggleSwitch';

describe('Button', () => {
  it('renders its label and forwards clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>New asset</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'New asset' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('defaults to the primary variant and supports ghost/danger', () => {
    const { rerender } = render(<Button>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'primary');
    rerender(<Button variant="ghost">Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'ghost');
    rerender(<Button variant="danger">Delete…</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'danger');
  });
});

describe('ToggleSwitch', () => {
  it('is a switch that reports the opposite state on click', async () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} onChange={onChange} label="Warranty alerts" />);
    const toggle = screen.getByRole('switch', { name: 'Warranty alerts' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' },
  ];

  it('marks the active segment and emits selections', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="comfortable" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute(
      'data-active',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(onChange).toHaveBeenCalledWith('compact');
  });
});

describe('Modal', () => {
  it('renders as a dialog, closes on Escape and overlay click but not card click', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Check in asset" subtitle="AST-0142" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: /check in asset/i })).toBeInTheDocument();

    await userEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('has a working close button', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Assign" onClose={onClose}>
        x
      </Modal>,
    );
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Menu', () => {
  const items = [
    { label: 'Change role', onSelect: vi.fn() },
    { label: 'Remove', onSelect: vi.fn(), danger: true },
  ];

  it('opens on the trigger and closes once something is chosen', async () => {
    render(<Menu label="Actions for Grace Chen" items={items} />);
    const trigger = screen.getByRole('button', { name: 'Actions for Grace Chen' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Change role' }));
    expect(items[0]!.onSelect).toHaveBeenCalled();
    // A menu left open over the row it just changed points at stale data.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on a click elsewhere', async () => {
    render(<Menu label="Actions" items={items} />);

    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('marks a destructive item so it does not read like the others', async () => {
    render(<Menu label="Actions" items={items} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveAttribute('data-danger', 'true');
  });
});

describe('Tabs', () => {
  it('marks the active tab and emits changes', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[
          { value: 'activity', label: 'Activity log' },
          { value: 'settings', label: 'Settings' },
        ]}
        value="activity"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Activity log' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(onChange).toHaveBeenCalledWith('settings');
  });
});

describe('FilterPills', () => {
  it('renders label with count as one string like the design and emits values', async () => {
    const onChange = vi.fn();
    render(
      <FilterPills
        options={[
          { value: 'all', label: 'All', count: 13 },
          { value: 'available', label: 'Available', count: 2 },
        ]}
        value="all"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'All 13' })).toHaveAttribute('data-active', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Available 2' }));
    expect(onChange).toHaveBeenCalledWith('available');
  });
});

describe('Pagination', () => {
  it('windows the pages around the current one, with both ends always reachable', () => {
    render(<Pagination page={6} pageCount={12} onChange={vi.fn()} />);
    const nav = within(screen.getByRole('navigation', { name: 'Pagination' }));

    expect(nav.getByRole('button', { name: '6' })).toHaveAttribute('aria-current', 'page');
    for (const label of ['1', '5', '7', '12']) {
      expect(nav.getByRole('button', { name: label })).not.toHaveAttribute('aria-current');
    }
    // Everything between the first page and the window is one ellipsis.
    expect(nav.queryByRole('button', { name: '3' })).toBeNull();
    expect(nav.queryByRole('button', { name: '9' })).toBeNull();
    expect(nav.getAllByText('…')).toHaveLength(2);
  });

  it('disables the step it cannot take and reports the page asked for', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageCount={3} onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onChange).toHaveBeenCalledWith(3);

    rerender(<Pagination page={3} pageCount={3} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('draws nothing at all when everything fits on one page', () => {
    const { container } = render(<Pagination page={1} pageCount={1} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the rows-per-page sizes and reports the one chosen', async () => {
    const onChange = vi.fn();
    render(
      <Pagination page={1} pageCount={4} onChange={vi.fn()} rowsPerPage={{ size: 50, onChange }} />,
    );

    await choose(screen, 'Rows per page', '10');
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('keeps the selector on a list short enough to need no numbers', async () => {
    // Thirty rows at fifty a page is one page — and the only way back to ten.
    render(
      <Pagination
        page={1}
        pageCount={1}
        onChange={vi.fn()}
        rowsPerPage={{ size: 50, onChange: vi.fn() }}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveTextContent('50');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
  });

  it('draws nothing for a list with no rows, selector or not', () => {
    // Nothing to page is nothing to size: an empty state is not a table.
    const { container } = render(
      <Pagination
        page={1}
        pageCount={0}
        onChange={vi.fn()}
        rowsPerPage={{ size: 50, onChange: vi.fn() }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Pill', () => {
  it('exposes its semantic color and renders an optional dot', () => {
    const { rerender } = render(<Pill sv="warn">In repair</Pill>);
    const pill = screen.getByText('In repair');
    expect(pill).toHaveAttribute('data-sv', 'warn');
    expect(pill.querySelector('[data-dot]')).toBeNull();
    rerender(
      <Pill sv="ok" dot>
        Available
      </Pill>,
    );
    expect(screen.getByText('Available').querySelector('[data-dot]')).not.toBeNull();
  });
});

describe('Avatar', () => {
  it('shows initials on the hash-stable color', () => {
    render(<Avatar name="Maya Lindqvist" colorKey="emp-1" />);
    const avatar = screen.getByText('ML');
    expect(avatar.style.background).not.toBe('');
    expect(avatar).toHaveStyle({ background: avatarColor('emp-1') });
  });
});

describe('RadioCard', () => {
  it('selects on click and reflects checked state', async () => {
    const onChange = vi.fn();
    render(
      <RadioCard
        name="role"
        value="admin"
        checked={false}
        onChange={onChange}
        title="Admin"
        description="Full access — settings, members, activity log"
      />,
    );
    await userEvent.click(screen.getByText('Admin'));
    expect(onChange).toHaveBeenCalledWith('admin');
  });
});

describe('Checkbox', () => {
  it('toggles through its label', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Create another" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('Create another'));
    expect(onChange).toHaveBeenCalled();
  });
});

describe('Field', () => {
  it('ties a server field message to the input it is about', () => {
    render(
      <Field label="Name" error="Give the token a name.">
        {(id) => <Input id={id} defaultValue="" />}
      </Field>,
    );

    // The message is rendered — but a reader who never sees the red line needs
    // the input itself to say it is wrong, and to point at the words.
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Give the token a name.');
  });

  it('says nothing of the sort while the field is fine', () => {
    render(
      <Field label="Name" hint="What holds it">
        {(id) => <Input id={id} defaultValue="" />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('does the same for the app’s only select', () => {
    render(
      <Field label="Expires" error="Pick a lifetime.">
        {(id) => (
          <Dropdown
            id={id}
            value="30"
            options={[{ value: '30', label: '30 days' }]}
            onChange={() => {}}
          />
        )}
      </Field>,
    );
    const control = screen.getByRole('combobox', { name: 'Expires' });
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(control.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Pick a lifetime.',
    );
  });
});

describe('SearchInput', () => {
  it('emits typed values', async () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Filter assets…" />);
    await userEvent.type(screen.getByPlaceholderText('Filter assets…'), 'mac');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('DataTable', () => {
  const columns = [
    { header: 'Asset', width: 'minmax(210px,1.6fr)', render: (r: { name: string }) => r.name },
    { header: 'Serial', width: '130px', render: () => 'X' },
  ];

  it('applies the design grid template to header and rows', () => {
    render(<DataTable columns={columns} rows={[{ name: 'MacBook Pro' }]} rowKey={(r) => r.name} />);
    const header = screen.getByTestId('table-header');
    expect(header.style.gridTemplateColumns).toBe('minmax(210px,1.6fr) 130px');
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
  });

  it('forwards row clicks', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[{ name: 'MacBook Pro' }]}
        rowKey={(r) => r.name}
        onRowClick={onRowClick}
      />,
    );
    await userEvent.click(screen.getByText('MacBook Pro'));
    expect(onRowClick).toHaveBeenCalledWith({ name: 'MacBook Pro' });
  });
});

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function Demo() {
    const { show } = useToast();
    return (
      <button type="button" onClick={() => show('Asset checked in', 'ok')}>
        trigger
      </button>
    );
  }

  it('shows a toast and auto-dismisses it', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Demo />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('trigger'));
    expect(screen.getByText('Asset checked in')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.queryByText('Asset checked in')).toBeNull();
  });
});
