// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CatalogSearch from '@/components/CatalogSearch';

const items = [
  { id: 'a', name: 'Stump grinding', defaultPrice: 120 },
  { id: 'b', name: 'Tree removal', defaultPrice: 800 },
  { id: 'c', name: 'Tree trimming', defaultPrice: 300 },
];
const fmt = (n: number) => `$${n}`;

import { afterEach } from 'vitest';
afterEach(cleanup);

describe('CatalogSearch', () => {
  it('filters the catalog by name as the user types', () => {
    render(<CatalogSearch items={items} onSelect={() => {}} formatPrice={fmt} />);
    const input = screen.getByLabelText('Add from catalog');
    fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(3);

    fireEvent.change(input, { target: { value: 'TREE' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('Tree removal');

    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No matching services')).toBeTruthy();
  });

  it('selects an item by click and clears the search', () => {
    const onSelect = vi.fn();
    render(<CatalogSearch items={items} onSelect={onSelect} formatPrice={fmt} />);
    const input = screen.getByLabelText('Add from catalog') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'stump' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /Stump grinding/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(input.value).toBe('');
  });

  it('selects the highlighted match with Enter', () => {
    const onSelect = vi.fn();
    render(<CatalogSearch items={items} onSelect={onSelect} formatPrice={fmt} />);
    const input = screen.getByLabelText('Add from catalog');
    fireEvent.change(input, { target: { value: 'tree' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('c');
  });
});
