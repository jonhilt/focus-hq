/** Where to watch a cloud agent's session on claude.ai. Undefined until Claude Code has reported the session's id. */
export function cloudSessionUrl(agent: { cloud?: boolean; sessionId?: string }): string | undefined {
  const id = agent.sessionId;
  return agent.cloud && id && /^(session|cse)_\w+$/.test(id) ? `https://claude.ai/code/${id}` : undefined;
}
