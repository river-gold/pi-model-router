export const OPENCODE_HOST = "opencode.ai";
export const OPENCODE_SESSION_HEADER = "x-opencode-session";
export const OPENCODE_CLIENT_HEADER = "x-opencode-client";
export const OPENCODE_CLIENT_VALUE = "pi";

export type AttributionModel = {
  provider?: string;
  baseUrl?: string;
};

export const matchesOpencodeHost = (baseUrl: string | undefined): boolean => {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname === OPENCODE_HOST;
  } catch {
    return false;
  }
};

export const isOpencodeTarget = (model: AttributionModel): boolean =>
  model.provider === "opencode" ||
  model.provider === "opencode-go" ||
  matchesOpencodeHost(model.baseUrl);

export const getOpencodeSessionHeaders = (
  model: AttributionModel,
  sessionId: string | undefined,
): Record<string, string> | undefined => {
  if (!sessionId) return undefined;
  if (!isOpencodeTarget(model)) return undefined;
  return {
    [OPENCODE_SESSION_HEADER]: sessionId,
    [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT_VALUE,
  };
};

export const mergeDelegatedHeaders = (
  model: AttributionModel,
  sessionId: string | undefined,
  callerHeaders: Record<string, string | null> | undefined,
  authHeaders: Record<string, string | null> | undefined,
): Record<string, string | null> | undefined => {
  const sessionHeaders = getOpencodeSessionHeaders(model, sessionId);
  if (!sessionHeaders && !callerHeaders && !authHeaders) return undefined;
  return { ...sessionHeaders, ...authHeaders, ...callerHeaders };
};
