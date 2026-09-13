import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

/** JSONC 텍스트를 파싱한다. 주석·후행 콤마를 허용하고, 파싱 실패는 예외를 던진다. */
export const parseJsonc = (text: string): unknown => {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const reason = errors.map((e) => `${printParseErrorCode(e.error)}@${e.offset}`).join(", ");
    throw new Error(`invalid JSONC (${reason})`);
  }
  return parsed;
};
