import { describe, expect, it } from "vitest";
import { parseAgyStreamLine } from "../../src/agy/parse";

describe("parseAgyStreamLine NDJSON 파싱을 검증함", () => {
  it("malformed JSON과 non-JSON 줄은 undefined를 반환함을 검증함", () => {
    expect(parseAgyStreamLine("")).toBeUndefined();
    expect(parseAgyStreamLine("not json")).toBeUndefined();
    expect(parseAgyStreamLine("{ broken")).toBeUndefined();
    expect(parseAgyStreamLine("[]")).toBeUndefined();
  });

  it("init 이벤트와 알 수 없는 이벤트는 undefined를 반환함을 검증함", () => {
    expect(parseAgyStreamLine('{"event":"init","conversation_id":"c1"}')).toBeUndefined();
    expect(parseAgyStreamLine('{"event":"unknown"}')).toBeUndefined();
  });

  it("agent_response가 아닌 step_update는 undefined를 반환함을 검증함", () => {
    expect(
      parseAgyStreamLine('{"event":"step_update","step_update":{"step_type":"tool"}}'),
    ).toBeUndefined();
  });

  it("text_delta가 없거나 빈 step_update는 undefined를 반환함을 검증함", () => {
    expect(
      parseAgyStreamLine('{"event":"step_update","step_update":{"step_type":"agent_response"}}'),
    ).toBeUndefined();
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":""}}',
      ),
    ).toBeUndefined();
  });

  it("ACTIVE/DONE 상태의 agent_response delta를 텍스트로 반환함을 검증함", () => {
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":"he"}}',
      ),
    ).toEqual({ kind: "text", text: "he", snapshot: false });
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":{"step_type":"agent_response","state":"DONE","text_delta":"llo"}}',
      ),
    ).toEqual({ kind: "text", text: "llo", snapshot: false });
  });

  it("status DONE인 agent_response도 스냅샷 텍스트로 반환함을 검증함", () => {
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":{"step_type":"agent_response","status":"DONE","text_delta":"ok"}}',
      ),
    ).toEqual({ kind: "text", text: "ok", snapshot: true });
  });

  it("state/status가 둘 다 아니면 텍스트로 반환하지 않음을 검증함", () => {
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":{"step_type":"agent_response","state":"PENDING","text_delta":"ok"}}',
      ),
    ).toBeUndefined();
  });

  it("result 이벤트의 response/status/error를 반환함을 검증함", () => {
    expect(
      parseAgyStreamLine('{"event":"result","result":{"response":"high","status":"SUCCESS"}}'),
    ).toEqual({ kind: "result", response: "high", status: "SUCCESS", error: undefined });
    expect(
      parseAgyStreamLine(
        '{"event":"result","conversation_id":"c1","status":"FAILED","error":"boom"}',
      ),
    ).toEqual({ kind: "result", response: undefined, status: "FAILED", error: "boom" });
  });

  it("step_update에 중첩 필드가 없으면 루트 필드를 폴백으로 씀을 검증함", () => {
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":{},"step_type":"agent_response","text_delta":"ok","state":"DONE"}',
      ),
    ).toEqual({ kind: "text", text: "ok", snapshot: false });
  });

  it("step_update가 객체가 아니면 루트로 폴백함을 검증함", () => {
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":"x","step_type":"agent_response","text_delta":"ok","state":"ACTIVE"}',
      ),
    ).toEqual({ kind: "text", text: "ok", snapshot: false });
  });

  it("result가 객체가 아니면 빈 result로 취급함을 검증함", () => {
    expect(parseAgyStreamLine('{"event":"result","result":"broken","status":"FAILED"}')).toEqual({
      kind: "result",
      response: undefined,
      status: undefined,
      error: undefined,
    });
  });

  it("result가 아닌 다른 형태의 step_update 중첩 구조도 파싱함을 검증함", () => {
    expect(
      parseAgyStreamLine('{"event":"step_update","step_type":"agent_response","state":"DONE"}'),
    ).toBeUndefined();
  });
});
