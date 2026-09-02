import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RoutingDecision } from "./types";

export const formatDecision = (decision: RoutingDecision): string => {
	return `${decision.profile}: ${decision.tier} -> ${decision.targetProvider}/${decision.targetModelId} [${decision.thinking ?? "auto"}] (${decision.reasoning})`;
};

export const formatModelRef = (ref: string | undefined): string => {
	return ref ?? "none";
};

export const updateStatus = (
	ctx: ExtensionContext,
	routerEnabled: boolean,
	selectedProfile: string | undefined,
	lastDecision: RoutingDecision | undefined,
) => {
	const activeRouterProfile = routerEnabled ? selectedProfile : undefined;

	if (activeRouterProfile) {
		const matchesProfile =
			lastDecision && lastDecision.profile === activeRouterProfile;

		let statusText: string;
		if (lastDecision && matchesProfile) {
/* v8 ignore next */
			statusText = `router:${activeRouterProfile} -> ${lastDecision.tier} -> ${lastDecision.targetProvider}/${lastDecision.targetModelId} (${lastDecision.thinking ?? "auto"})`;
		} else {
			statusText = `router:${activeRouterProfile} -> waiting`;
		}
		ctx.ui.setStatus("router", `🚥 ${statusText}`);
	} else {
		ctx.ui.setStatus("router", undefined);
	}
};
