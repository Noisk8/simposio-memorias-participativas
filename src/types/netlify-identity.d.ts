/* eslint-disable */
export {};

interface NetlifyIdentityUser {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface NetlifyIdentity {
  currentUser(): NetlifyIdentityUser | null;
  on(event: 'init', callback: (user: NetlifyIdentityUser | null) => void): void;
  on(event: 'login', callback: (user: NetlifyIdentityUser) => void): void;
  on(event: 'logout', callback: () => void): void;
  open(tab?: 'login' | 'signup'): void;
  logout(): void;
}

declare global {
  interface Window {
    netlifyIdentity?: NetlifyIdentity;
  }
}
