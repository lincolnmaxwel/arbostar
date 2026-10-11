'use client';

import { useId, useMemo, useState } from 'react';
import styles from '../app/timesheet/timesheet.module.css';

export interface CatalogSearchItem {
  id: string;
  name: string;
  defaultPrice: number | string;
}

interface Props {
  items: CatalogSearchItem[];
  onSelect: (itemId: string) => void;
  formatPrice: (price: number) => string;
}

// Type-to-filter replacement for the old "Add from catalog" <select>, so a
// long service catalog can be narrowed by name instead of scrolled.
export default function CatalogSearch({ items, onSelect, formatPrice }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
  }, [items, query]);

  function choose(itemId: string) {
    onSelect(itemId);
    setQuery('');
    setOpen(false);
    setActive(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Never let Enter submit the surrounding timesheet form.
      e.preventDefault();
      if (open && matches[active]) choose(matches[active].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={styles.catalogSearch}>
      <input
        type="search"
        role="combobox"
        aria-label="Add from catalog"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={styles.catalogSelect}
        placeholder="Add from catalog (type to search)"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className={styles.catalogDropdown}>
          {matches.length === 0 ? (
            <li className={styles.catalogEmpty}>No matching services</li>
          ) : (
            matches.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  className={`${styles.catalogOption} ${index === active ? styles.catalogOptionActive : ''}`}
                  // mousedown (not click) so it fires before the input's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(item.id);
                  }}
                >
                  {item.name} ({formatPrice(Number(item.defaultPrice))})
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
