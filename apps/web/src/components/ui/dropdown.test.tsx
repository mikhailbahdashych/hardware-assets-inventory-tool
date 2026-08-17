import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';
import type { DropdownOption } from './types/dropdown';

const STATUSES: DropdownOption<string>[] = [
  { value: 'available', label: 'Available' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'retired', label: 'Retired' },
];

function Harness({
  initial = 'available',
  onChange,
  options = STATUSES,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  options?: DropdownOption<string>[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <Dropdown
      value={value}
      options={options}
      aria-label="Status"
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Status' });

describe('what it shows when closed', () => {
  it('is a combobox naming the option that is chosen', () => {
    render(<Harness />);
    expect(trigger()).toHaveTextContent('Available');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('says nothing is chosen rather than showing a stale label', () => {
    render(<Harness initial="nothing-matches-this" />);
    expect(trigger()).toHaveTextContent('Select…');
  });
});

describe('opening and choosing', () => {
  it('opens on click and lists every option, marking the chosen one', async () => {
    render(<Harness />);
    await userEvent.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Available',
      'Assigned',
      'In repair',
      'Retired',
    ]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the value, not the label, and closes', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('option', { name: 'In repair' }));

    expect(onChange).toHaveBeenCalledWith('in_repair');
    expect(trigger()).toHaveTextContent('In repair');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('closes on a click outside without changing anything', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(trigger());
    await userEvent.click(document.body);

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cannot be opened when it is disabled', async () => {
    render(
      <Dropdown
        value="available"
        options={STATUSES}
        aria-label="Status"
        disabled
        onChange={vi.fn()}
      />,
    );
    expect(trigger()).toBeDisabled();
    await userEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('the keyboard', () => {
  it('opens on Enter, Space and either arrow', async () => {
    render(<Harness />);
    for (const key of ['{Enter}', ' ', '{ArrowDown}', '{ArrowUp}']) {
      trigger().focus();
      await userEvent.keyboard(key);
      expect(screen.getByRole('listbox'), `opened with ${key}`).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
    }
  });

  it('starts on the chosen option, so a stray Enter changes nothing', async () => {
    const onChange = vi.fn();
    render(<Harness initial="in_repair" onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('option', { name: 'In repair' })).toHaveAttribute(
      'data-active',
      'true',
    );

    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('in_repair');
  });

  it('moves with the arrows and stops at the ends, like a select', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    trigger().focus();
    await userEvent.keyboard('{Enter}');

    // Already on the first option; up goes nowhere.
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: 'Available' })).toHaveAttribute(
      'data-active',
      'true',
    );

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('in_repair');
  });

  it('jumps to the ends with Home and End', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    trigger().focus();
    await userEvent.keyboard('{Enter}{End}{Enter}');
    expect(onChange).toHaveBeenCalledWith('retired');
  });

  it('jumps to an option by its first letter, cycling through the matches', async () => {
    render(<Harness />);
    trigger().focus();
    await userEvent.keyboard('{Enter}');

    await userEvent.keyboard('r');
    expect(screen.getByRole('option', { name: 'Retired' })).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('a');
    expect(screen.getByRole('option', { name: 'Available' })).toHaveAttribute(
      'data-active',
      'true',
    );
    // A second 'a' moves to the next option starting with it, and wraps.
    await userEvent.keyboard('a');
    expect(screen.getByRole('option', { name: 'Assigned' })).toHaveAttribute('data-active', 'true');
  });

  it('closes on Escape and hands focus back, unchanged', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard('{Enter}{ArrowDown}{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });

  it('closes on Tab so focus can leave the field', async () => {
    render(<Harness />);
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});

describe('what a screen reader is told', () => {
  it('points at the highlighted option while it is open', async () => {
    render(<Harness />);
    await userEvent.click(trigger());

    const listbox = screen.getByRole('listbox');
    expect(trigger()).toHaveAttribute('aria-controls', listbox.id);
    expect(trigger()).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Available' }).id,
    );
  });

  it('takes its name from a label that points at it', async () => {
    render(
      <>
        <label htmlFor="status-field">Asset status</label>
        <Dropdown id="status-field" value="assigned" options={STATUSES} onChange={vi.fn()} />
      </>,
    );
    // A <button> is a labelable element, so the field's own label names it.
    expect(screen.getByRole('combobox', { name: 'Asset status' })).toBeInTheDocument();
  });
});

describe('an option with a second line', () => {
  it('shows the description without putting it in the closed state', async () => {
    render(
      <Harness
        options={[
          { value: 'admin', label: 'Admin', description: 'Full access' },
          { value: 'viewer', label: 'Viewer', description: 'Read-only' },
        ]}
        initial="admin"
      />,
    );
    expect(trigger()).toHaveTextContent('Admin');
    expect(trigger()).not.toHaveTextContent('Full access');

    await userEvent.click(trigger());
    expect(screen.getByRole('option', { name: /Admin/ })).toHaveTextContent('Full access');
  });
});
