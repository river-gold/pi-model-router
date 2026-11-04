export const isEqualPersistedState = (
  prevSnapshot: string | undefined,
  nextSnapshot: string,
): boolean => prevSnapshot === nextSnapshot;
