import type { Context, Message } from '@earendil-works/pi-ai';

export const extractTextFromContent = (
  content: string | Message['content'],
): string => {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'thinking') return part.thinking;
      if (part.type === 'toolCall')
        return `${part.name} ${JSON.stringify(part.arguments)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

export const getLastUserText = (context: Context): string => {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role === 'user') {
      return extractTextFromContent(message.content).trim();
    }
  }
  return '';
};



export const hasImageAttachment = (context: Context): boolean => {
  return context.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image'),
  );
};

export const getHistoryPairsText = (context: Context, pairCount: number): string => {
  if (!pairCount || pairCount <= 0) return '';
  const messages = context.messages;
  const pairs: string[] = [];
  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') userIndices.push(i);
  }
  const lastUserIdx = userIndices.length > 0 ? userIndices[userIndices.length - 1] : -1;
  const historyUserIndices = lastUserIdx >= 0 ? userIndices.slice(0, -1).slice(-pairCount) : [];
  // O(1) next-user lookup via position map instead of O(N) find per iteration
  const userPosByIndex = new Map<number, number>();
  for (let p = 0; p < userIndices.length; p++) {
    userPosByIndex.set(userIndices[p], p);
  }
  for (const uIdx of historyUserIndices) {
    const userText = extractTextFromContent(messages[uIdx].content).trim();
    if (!userText) continue;
    const pos = userPosByIndex.get(uIdx) ?? -1;
    const nextUserIdx = pos >= 0 && pos + 1 < userIndices.length ? userIndices[pos + 1] : messages.length;
    let finalText = '';
    for (let j = nextUserIdx - 1; j > uIdx; j--) {
      const msg = messages[j];
      if (msg.role === 'assistant' || msg.role === 'toolResult') {
        const txt = extractTextFromContent(msg.content).trim();
        if (txt) {
          finalText = txt;
          break;
        }
      }
    }
    if (finalText) {
      pairs.push(`${userText}\n${finalText}`);
    } else {
      pairs.push(userText);
    }
  }
  return pairs.join('\n---\n');
};

 // Rough token estimate. chars/3 underestimates CJK (한글 1 char ≈ 1–1.5 tokens);
// a safer heuristic would be chars/2.5, but keep /3 for backward compat.
// systemPrompt/tools/image tokens are not fully included in truncateContext —
// callers must account for that budget externally.
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

export const truncateContext = (context: Context, limit: number): Context => {
  const messages = [...context.messages];
  // Single-message context: even if it exceeds limit we cannot safely drop the
  // latest user prompt without data loss. Return as-is; caller must handle via
  // compaction or explicit error. Token budget for systemPrompt/tools/image
  // content is approximated via estimateTokens(systemPrompt) only.
  if (messages.length <= 1) return context;

  const systemTokens = context.systemPrompt ? estimateTokens(context.systemPrompt) : 0;

  const messageTokens = messages.map((m) =>
    estimateTokens(extractTextFromContent(m.content)),
  );
  const totalTokens = systemTokens + messageTokens.reduce((sum, t) => sum + t, 0);

  if (totalTokens <= limit) return context;

  const latestMessage = messages.pop();
  if (!latestMessage) return context;
  const latestTokens = messageTokens.pop() ?? 0;

  let activeMessagesTokensSum = messageTokens.reduce((sum, t) => sum + t, 0);

  let startIndex = 0;
  for (; startIndex < messages.length; startIndex++) {
    const currentTokens = systemTokens + latestTokens + activeMessagesTokensSum;
    if (currentTokens <= limit) break;
    activeMessagesTokensSum -= messageTokens[startIndex];
  }

  // Align startIndex to next user boundary to avoid splitting a turn in the
  // middle and to preserve toolCall/toolResult pairing. Further truncation
  // keeps us within budget (more dropped => fewer tokens).
  if (startIndex < messages.length) {
    let aligned = startIndex;
    for (let a = startIndex; a < messages.length; a++) {
      if (messages[a].role === 'user') {
        aligned = a;
        break;
      }
      if (a === messages.length - 1) {
        aligned = messages.length;
      }
    }
    startIndex = aligned;
  }

  let finalMessages = [...messages.slice(startIndex), latestMessage];
  // Drop leading orphan toolResult(s) that lost their assistant toolCall.
  // Uses a for-loop (no while) to satisfy AGENTS.md style rule.
  let orphanCount = 0;
  for (let k = 0; k < finalMessages.length; k++) {
    if (finalMessages[k].role === 'toolResult' && k === orphanCount) {
      orphanCount++;
    } else {
      break;
    }
  }
  if (orphanCount > 0) {
    finalMessages = finalMessages.slice(orphanCount);
  }
  return { ...context, messages: finalMessages };
};
