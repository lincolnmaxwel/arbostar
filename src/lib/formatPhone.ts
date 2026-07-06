// Formats as the user types: (xxx) xxx-xxxx. Extra digits beyond 10 are
// dropped rather than appended — a mis-paste or extra keystroke just stops
// growing the string instead of producing a mangled longer mask.
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  const len = digits.length;
  if (len === 0) return '';
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
