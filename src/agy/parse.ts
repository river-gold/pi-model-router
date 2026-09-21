/**
 * agy stream-json stdout NDJSON 한 줄 파싱 (pi-agent-bridge의 파서 계약을 따름).
 * 분류기에 필요한 것만 추출함: agent_response text delta와 최종 result 이벤트.
 */
import { isObjectRecord } from "../config";

const pickString = (primary: unknown, fallback: unknown): string | undefined => {
  if (typeof primary === "string") return primary;
  if (typeof fallback === "string") return fallback;
  return undefined;
};

export type AgyParsedLine =
  | {
      kind: "text";
      text: string;
      /** status DONE 스냅샷(전체 텍스트)이면 true — 누적 시 suffix만 반영해야 함. */
      snapshot: boolean;
    }
  | {
      kind: "result";
      response?: string;
      status?: string;
      error?: string;
    };

/**
 * 한 줄을 파싱함. 분류에 쓸 수 없는 줄(init, tool step, malformed JSON)은 undefined.
 */
export const parseAgyStreamLine = (rawLine: string): AgyParsedLine | undefined => {
  const line = rawLine.trim();
  if (!line.startsWith("{")) return undefined;
  // "{"로 시작하는 텍스트는 항상 JSON 객체로 파싱되거나 예외가 남.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (parsed.event === "step_update") {
    const stepRaw = parsed.step_update ?? parsed;
    const step = isObjectRecord(stepRaw) ? stepRaw : {};
    if (pickString(step.step_type, parsed.step_type) !== "agent_response") return undefined;
    const textDelta = pickString(step.text_delta, parsed.text_delta);
    if (!textDelta) return undefined;
    const state = pickString(step.state, parsed.state);
    const status = pickString(step.status, parsed.status);
    if (state === "ACTIVE" || state === "DONE") {
      return { kind: "text", text: textDelta, snapshot: false };
    }
    if (status === "DONE") return { kind: "text", text: textDelta, snapshot: true };
    return undefined;
  }

  if (parsed.event !== "result") return undefined;
  const resultRaw = parsed.result ?? parsed;
  const result = isObjectRecord(resultRaw) ? resultRaw : {};
  return {
    kind: "result",
    response: typeof result.response === "string" ? result.response : undefined,
    status: typeof result.status === "string" ? result.status : undefined,
    error: typeof result.error === "string" ? result.error : undefined,
  };
};
