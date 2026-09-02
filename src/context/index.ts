export { extractTextFromContent, extractPartText } from "./extract";
export { getLastUserText, findLastUserIndex } from "./lastUser";
export {
  getHistoryPairsText,
  collectUserIndices,
  resolveHistoryUserIndices,
  buildUserPosMap,
  findFinalTextBetween,
  isAssistantOrToolResult,
  getNextUserIdx,
} from "./history";
export { estimateTokens } from "./tokens";
export {
  truncateContext,
  calculateSystemTokens,
  calculateMessageTokens,
  findStartIndex,
  alignToUserBoundary,
  countLeadingOrphanToolResults,
} from "./truncate";
