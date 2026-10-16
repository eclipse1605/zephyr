export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#10241a" />
      <path d="M7 11h10.2c2.2 0 3.5 1.3 3.5 2.8 0 1.9-1.6 2.9-3.8 2.9H9.2" fill="none" stroke="#5dcca0" strokeWidth="2.15" strokeLinecap="round" />
      <path d="M9.2 16.7h9.6c2.4 0 3.9 1.2 3.9 2.8 0 1.4-1.1 2.5-3.1 2.5H13" fill="none" stroke="#d7f5a3" strokeWidth="2.15" strokeLinecap="round" />
      <path d="M13 22h8.2" fill="none" stroke="#e7c56a" strokeWidth="2.15" strokeLinecap="round" />
      <circle cx="23.2" cy="9.4" r="1.7" fill="#e7c56a" />
    </svg>
  );
}
