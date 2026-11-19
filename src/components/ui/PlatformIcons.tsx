import React from 'react';

/**
 * Official Kick stepped geometric "K" vector mark (#53FC18 Kick Green)
 * Derived from Wikimedia Commons Kick_logo.svg geometric grid proportions.
 */
export function KickLogoIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 2h5.5v6h2.75V5h2.75V2H21v6h-2.75v3h-2.75v2h2.75v3H21v6h-7v-3h-2.75v-3H8.5v6H3V2z" />
    </svg>
  );
}

/**
 * Crisp minimal Instagram outline camera mark for Insta Short overlays & wireframes.
 */
export function InstagramIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.25" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Crisp YouTube Shorts bolt/play vector mark for YT Short overlays & wireframes.
 */
export function YouTubeShortsIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.77 10.32 16.5 9.6l1.27-.72a3.7 3.7 0 0 0 1.4-5.05 3.7 3.7 0 0 0-5.05-1.36L6.23 6.95a3.7 3.7 0 0 0-1.4 5.05c.33.58.8 1.05 1.38 1.38l1.29.72-1.27.72a3.7 3.7 0 0 0-1.4 5.05 3.7 3.7 0 0 0 5.05 1.36l7.89-4.48a3.7 3.7 0 0 0 1.4-5.05 3.68 3.68 0 0 0-1.4-1.38ZM10 15V9l5 3-5 3Z" />
    </svg>
  );
}
