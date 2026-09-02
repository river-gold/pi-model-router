export const chainKeyForRoute = (profile: string, tier: string): string =>
  `route:${profile}:${tier}`;

export const normalizeFailedRef = (ref: string): string => ref.trim();
