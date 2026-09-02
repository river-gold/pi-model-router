import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProviderState } from "./state";

export const safeUpdateStatus = (
  state: RouterProviderState,
  actions: { updateStatus: (ctx: ExtensionContext) => void },
): void => {
  try {
    if (state.lastExtensionContext) actions.updateStatus(state.lastExtensionContext);
  } catch {
    // stale
  }
};

export const safePersist = (actions: { persistState: () => void }): void => {
  try {
    actions.persistState();
  } catch {
    // stale
  }
};
