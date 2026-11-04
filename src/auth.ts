import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * pi는 라우팅된 모델의 provider가 인증됐는지 `hasConfiguredAuth`로 확인하고,
 * 아니면 요청을 오류로 끝낸다. 그 판정과 다르면 폴백 기회 없이 실패하므로 함께 확인한다.
 */
export const hasUsableAuth = async (ctx: ExtensionContext, model: Model<Api>): Promise<boolean> => {
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) return false;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  return auth.ok && Boolean(auth.apiKey);
};
