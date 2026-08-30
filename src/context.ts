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

export const getLastPromptText = (context: Context): string => {
  if (context.messages.length === 0) return '';
  const last = context.messages[context.messages.length - 1];
  if (last.role === 'toolResult' || last.role === 'user') {
    const text = extractTextFromContent(last.content).trim();
    if (text) return text;
  }
  return getLastUserText(context);
};

export const getRecentConversationText = (
  context: Context,
  limit = 6,
): string => {
  return context.messages
    .slice(-limit)
    .map((message) => extractTextFromContent(message.content).trim())
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
};

export const countToolResults = (context: Context): number => {
  return context.messages.filter((message) => message.role === 'toolResult')
    .length;
};

export const countWords = (text: string): number => {
  return text.split(/\s+/).filter(Boolean).length;
};

export const hasImageAttachment = (context: Context): boolean => {
  return context.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image'),
  );
};

export const containsAny = (text: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => text.includes(keyword));
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
  for (const uIdx of historyUserIndices) {
    const userText = extractTextFromContent(messages[uIdx].content).trim();
    if (!userText) continue;
    const nextUserIdx = userIndices.find((idx) => idx > uIdx) ?? messages.length;
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

export const getPromptWithHistory = (context: Context, historySize: number): string => {
  const promptText = getLastUserText(context);
  if (!historySize || historySize <= 0) return promptText;
  const historyText = getHistoryPairsText(context, historySize);
  if (!historyText) return promptText;
  return `${historyText}\n---\n${promptText}`;
};

export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

export const truncateContext = (context: Context, limit: number): Context => {
  const messages = [...context.messages];
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
  while (startIndex < messages.length) {
    const currentTokens = systemTokens + latestTokens + activeMessagesTokensSum;
    if (currentTokens <= limit) break;

    activeMessagesTokensSum -= messageTokens[startIndex];
    startIndex++;
  }

  const finalMessages = [...messages.slice(startIndex), latestMessage];
  return { ...context, messages: finalMessages };
};
