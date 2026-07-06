// tests/unit/PortalItemsTable.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PortalItemsTable } from '@/components/PortalItemsTable';

describe('PortalItemsTable', () => {
  afterEach(cleanup);

  it('renders items and opens a photo in a lightbox, navigating between photos', () => {
    render(
      <PortalItemsTable
        items={[
          {
            id: 'i1',
            title: 'Hedges',
            description: 'Trim the top',
            price: 1250,
            photos: [
              { id: 'p1', filePath: '/uploads/quotes/q1/p1.jpg' },
              { id: 'p2', filePath: '/uploads/quotes/q1/p2.jpg' },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Hedges')).toBeInTheDocument();
    expect(screen.getByText('$1250.00')).toBeInTheDocument();

    const thumbButtons = screen.getAllByLabelText('View photo for Hedges');
    expect(thumbButtons).toHaveLength(2);

    fireEvent.click(thumbButtons[0]);
    expect(screen.getByTestId('photo-lightbox')).toBeInTheDocument();
    expect(screen.getByText('Hedges — 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByText('Hedges — 2 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('photo-lightbox')).not.toBeInTheDocument();
  });

  it('does not render a photos section for an item with no photos', () => {
    render(
      <PortalItemsTable
        items={[{ id: 'i2', title: 'Stump grinding', description: null, price: 150, photos: [] }]}
      />,
    );

    expect(screen.getByText('Stump grinding')).toBeInTheDocument();
    expect(screen.queryByLabelText(/view photo/i)).not.toBeInTheDocument();
  });
});
