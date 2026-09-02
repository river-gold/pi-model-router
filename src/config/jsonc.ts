const isWhitespace = (char: string): boolean => /\s/.test(char);

export const stripComments = (text: string): string => {
  let result = "";
  let inString = false;
  let stringChar = "";
  let escaped = false;
  let inSingleLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const nextChar = text[i + 1] ?? "";

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      stringChar = char;
      result += char;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inSingleLineComment = true;
      i++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    result += char;
  }

  return result;
};

export const stripTrailingCommas = (text: string): string => {
  let stripped = "";
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      stripped += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      stringChar = char;
      stripped += char;
      continue;
    }
    if (char === ",") {
      let j = i + 1;
      for (; j < text.length && isWhitespace(text[j]!); j++) {}
      const nextNonSpace = text[j] ?? "";
      if (nextNonSpace === "}" || nextNonSpace === "]") {
        continue;
      }
    }
    stripped += char;
  }

  return stripped;
};

export const stripJsonc = (text: string): string => stripTrailingCommas(stripComments(text));
