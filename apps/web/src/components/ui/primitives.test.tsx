import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { avatarColor } from '@/lib/avatar';
import { ToastProvider, useToast } from '@/providers/ToastProvider';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { DataTable } from './DataTable';
import { FilterPills } from './FilterPills';
import { Modal } from './Modal';
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
