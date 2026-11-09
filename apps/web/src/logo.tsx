export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f6e56" />
      <path d="M7 13.2h11.2c2.1 0 3.3 1.1 3.3 2.5 0 1.6-1.4 2.5-3.4 2.5H9.4" fill="none" stroke="#d8fff1" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9.4 18.2h9.2c2.2 0 3.5 1 3.5 2.4 0 1.2-1 2.2-2.8 2.2H13" fill="none" stroke="#9eefd2" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="23.4" cy="9.2" r="1.6" fill="#f5c451" />
    </svg>
  );
}
