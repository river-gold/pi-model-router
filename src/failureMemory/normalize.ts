export const chainKeyForRoute = (router: string, tier: string): string =>
  `route:${router}:${tier}`;

export const normalizeFailedRef = (ref: string): string => ref.trim();
