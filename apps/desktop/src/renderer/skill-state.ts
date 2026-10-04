const SKILL_STATE_PATTERN = /<osade_skills>\s*([^<]*?)\s*<\/osade_skills>/giu;
const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const MAX_ACTIVE_SKILLS = 8;

export interface SkillStateSource {
  turns?: readonly { seq: number; role: 'user' | 'agent'; text: string }[];
  agent?: { final_message?: string | null; stream_text?: string | null } | null;
  output?: { kind: string; text?: string | null } | null;
}

/** Return the last skill declaration in a text, including an empty declaration that clears it. */
export function skillStateFromText(text: string): string[] | null {
  let state: string[] | null = null;
  for (const match of text.matchAll(SKILL_STATE_PATTERN)) {
    const names = (match[1] ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => SKILL_NAME.test(name));
    state = [...new Set(names)].slice(0, MAX_ACTIVE_SKILLS);
  }
  return state;
}

/** The marker is UI state, not conversation prose. */
export function stripSkillState(text: string): string {
  return text.replace(SKILL_STATE_PATTERN, '').replace(/\n{3,}/gu, '\n\n').trim();
}

/** Derive the focused agent's current selection from durable turns plus the live overlay. */
export function activeSkillsFromTask(task: SkillStateSource): string[] {
  let active: string[] = [];
  const agentTurns = [...(task.turns ?? [])]
    .filter((turn) => turn.role === 'agent')
    .sort((a, b) => a.seq - b.seq);
  const finalText =
    task.agent?.final_message ?? (task.output?.kind === 'final_output' ? task.output.text : null);
  const streamText =
    task.agent?.stream_text ?? (task.output?.kind === 'partial_output' ? task.output.text : null);

  for (const text of [...agentTurns.map((turn) => turn.text), finalText, streamText]) {
    if (!text) continue;
    const next = skillStateFromText(text);
    if (next != null) active = next;
  }
  return active;
}
