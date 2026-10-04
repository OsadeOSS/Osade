/**
 * An agent someone started by hand in a terminal tab, the way Orca lists them.
 *
 * Identity comes from the daemon, which walks the shell's child processes, so any agent counts —
 * kiro-cli, cline, freebuff, claude — whether or not it ever sets a title. The title (OSC 0/2)
 * only adds what the process table cannot say: whether the agent is busy, and the topic it gave
 * the session. Claude Code titles itself `✳ <topic>` when waiting and puts a spinner in front
 * while it works; Gemini uses ✦/◇; agents that set no title just stay "Running".
 */

export type TerminalAgentStatus = 'running' | 'working' | 'done';

export interface TerminalAgent {
  /** Daemon agent id, e.g. `claude`, `kiro`. */
  agent: string;
  /** Display name, e.g. `Kiro`. */
  name: string;
  status: TerminalAgentStatus;
  /** The topic the agent titled the session with, or its name before it has one. */
  label: string;
  /** When `status` last changed, ms since epoch. */
  since: number;
}

type TitleSignal = 'working' | 'waiting' | 'attention' | null;

const WAITING_GLYPHS = new Set(['✳', '◇']); // ✳ Claude, ◇ Gemini
const WORKING_GLYPHS = new Set(['✦', '⏲']); // ✦ ⏲ Gemini
const ATTENTION_GLYPHS = new Set(['✋']); // ✋ Gemini permission prompt

function isSpinner(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  // Braille spinners, and the quarter circles Claude Code uses since 2.1.228.
  return (code >= 0x2800 && code <= 0x28ff) || (code >= 0x25d0 && code <= 0x25d3);
}

function isGlyph(char: string): boolean {
  return (
    isSpinner(char) ||
    WAITING_GLYPHS.has(char) ||
    WORKING_GLYPHS.has(char) ||
    ATTENTION_GLYPHS.has(char) ||
    char === '.' ||
    char === '·'
  );
}

/** What a title says about the agent's state, and the topic left once its glyphs are gone. */
export function readTitle(title: string): { signal: TitleSignal; label: string } {
  let rest = title.trim();
  let signal: TitleSignal = null;
  while (rest.length > 0) {
    const char = String.fromCodePoint(rest.codePointAt(0)!);
    if (!isGlyph(char)) break;
    if (signal == null) {
      if (isSpinner(char) || WORKING_GLYPHS.has(char)) signal = 'working';
      else if (WAITING_GLYPHS.has(char)) signal = 'waiting';
      else if (ATTENTION_GLYPHS.has(char)) signal = 'attention';
    }
    rest = rest.slice(char.length).trimStart();
  }
  return { signal, label: rest.trim() };
}

/** A topic worth showing: not empty, not just the agent's name, not a program path. */
function usefulLabel(label: string, agent: TerminalAgent): boolean {
  const lower = label.toLowerCase();
  if (lower.length === 0) return false;
  if ([agent.agent, agent.name.toLowerCase()].some((n) => lower === n || lower === `${n} code` || lower === `${n} cli`)) {
    return false;
  }
  if (/[\\/]/.test(label) && /\.(?:exe|cmd|bat|ps1|js)\b/i.test(label)) return false;
  if (/^(?:windows )?powershell$|^cmd(?:\.exe)?$|^administrator:/i.test(label)) return false;
  return true;
}

/** The daemon's latest answer for this tab. Null means no agent runs there now. */
export function withProcess(
  prev: TerminalAgent | null,
  found: { agent: string; name: string } | null,
  now: number,
): TerminalAgent | null {
  if (found == null) return null;
  if (prev != null && prev.agent === found.agent) return prev;
  return { agent: found.agent, name: found.name, status: 'running', label: found.name, since: now };
}

/** Fold a title change into a known agent. Titles alone never create or remove one. */
export function withTitle(prev: TerminalAgent | null, title: string, now: number): TerminalAgent | null {
  if (prev == null) return null;
  const { signal, label: topic } = readTitle(title);

  let status = prev.status;
  if (signal === 'working') status = 'working';
  else if (signal === 'attention') status = 'done';
  // Waiting after a turn is "done, your move"; waiting before any work is just running.
  else if (signal === 'waiting') status = prev.status === 'running' ? 'running' : 'done';

  const label = usefulLabel(topic, prev) ? topic : prev.label;
  if (status === prev.status && label === prev.label) return prev;
  return { ...prev, status, label, since: status === prev.status ? prev.since : now };
}

export const TERMINAL_STATUS_LABEL: Record<TerminalAgentStatus, string> = {
  running: 'Running',
  working: 'Working',
  done: 'Done',
};
