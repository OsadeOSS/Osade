/**
 * Which coding agent a process is, from its executable name and command line — how a terminal
 * tab knows `kiro-cli`, `cline` or `claude` is running in it without the agent saying so.
 *
 * Native agents are recognised by executable (`claude.exe`, `kiro-cli`, `codex-x86_64-…`). Agents
 * shipped as Node or Python packages run as `node …/node_modules/<package>/…` or `python -m …`,
 * so for those the script (first non-flag argument) decides. Only that argument is read: a
 * prompt mentioning "claude" must not turn `node build.js` into an agent.
 */

export interface AgentIdentity {
  /** Stable id, e.g. `claude`, `kiro`. */
  id: string;
  name: string;
}

interface AgentSpec extends AgentIdentity {
  /** Executable or script basenames, without extension. */
  commands: readonly string[];
  /** npm package directories the agent installs as (`node_modules/<package>/`). */
  packages?: readonly string[];
  /** Executable name prefixes for versioned or per-platform binaries. */
  prefixes?: readonly string[];
}

const AGENTS: readonly AgentSpec[] = [
  { id: 'claude', name: 'Claude', commands: ['claude'], packages: ['@anthropic-ai/claude-code'] },
  { id: 'codex', name: 'Codex', commands: ['codex'], packages: ['@openai/codex'], prefixes: ['codex-'] },
  { id: 'gemini', name: 'Gemini', commands: ['gemini'], packages: ['@google/gemini-cli'] },
  { id: 'antigravity', name: 'Antigravity', commands: ['agy', 'antigravity'] },
  { id: 'opencode', name: 'OpenCode', commands: ['opencode'], packages: ['opencode-ai'], prefixes: ['opencode-'] },
  { id: 'cline', name: 'Cline', commands: ['cline'], packages: ['cline'] },
  { id: 'kiro', name: 'Kiro', commands: ['kiro-cli', 'kiro'] },
  { id: 'freebuff', name: 'Freebuff', commands: ['freebuff'], packages: ['freebuff'] },
  { id: 'codebuff', name: 'Codebuff', commands: ['codebuff'], packages: ['codebuff'] },
  { id: 'aider', name: 'Aider', commands: ['aider'], packages: ['aider-chat'] },
  { id: 'goose', name: 'Goose', commands: ['goose'] },
  { id: 'amp', name: 'Amp', commands: ['amp'], packages: ['@sourcegraph/amp'] },
  { id: 'kilo', name: 'Kilo Code', commands: ['kilo', 'kilocode'], packages: ['@kilocode/cli'] },
  { id: 'crush', name: 'Crush', commands: ['crush'], packages: ['@charmland/crush'] },
  { id: 'auggie', name: 'Auggie', commands: ['auggie'], packages: ['@augmentcode/auggie'] },
  { id: 'copilot', name: 'GitHub Copilot', commands: ['copilot'], packages: ['@github/copilot'] },
  { id: 'cursor', name: 'Cursor', commands: ['cursor-agent'] },
  { id: 'droid', name: 'Droid', commands: ['droid'] },
  { id: 'qwen', name: 'Qwen Code', commands: ['qwen'], packages: ['@qwen-code/qwen-code'] },
  { id: 'kimi', name: 'Kimi', commands: ['kimi', 'kimi-code'] },
  { id: 'vibe', name: 'Mistral Vibe', commands: ['vibe', 'mistral-vibe'] },
  { id: 'continue', name: 'Continue', commands: ['cn'], packages: ['@continuedev/cli'] },
  { id: 'hermes', name: 'Hermes', commands: ['hermes'] },
  { id: 'openclaw', name: 'OpenClaw', commands: ['openclaw'], packages: ['openclaw'] },
  { id: 'grok', name: 'Grok', commands: ['grok'], packages: ['@vibe-kit/grok-cli'], prefixes: ['grok-'] },
  { id: 'devin', name: 'Devin', commands: ['devin'] },
  { id: 'qoder', name: 'Qoder', commands: ['qodercli'], prefixes: ['qodercli-'] },
  { id: 'codebuddy', name: 'CodeBuddy', commands: ['codebuddy', 'cbc'], packages: ['@tencent-ai/codebuddy-code'] },
  { id: 'openclaude', name: 'OpenClaude', commands: ['openclaude'] },
  {
    id: 'pi',
    name: 'Pi',
    commands: ['pi'],
    packages: ['@mariozechner/pi-coding-agent', '@earendil-works/pi-coding-agent'],
  },
  { id: 'trae', name: 'Trae', commands: ['traecli'] },
  { id: 'autohand', name: 'Autohand', commands: ['autohand'] },
  { id: 'command-code', name: 'Command Code', commands: ['command-code'] },
  { id: 'mimo', name: 'MiMo Code', commands: ['mimo'] },
  { id: 'zcode', name: 'ZCode', commands: ['zcode', 'zcode-cli'], packages: ['@zcode/cli'] },
  { id: 'jcode', name: 'Jcode', commands: ['jcode'] },
];

/** Runtimes whose own name says nothing; the script they run is the identity. */
const WRAPPERS = new Set(['node', 'nodejs', 'bun', 'deno', 'python', 'python3', 'pythonw', 'py', 'uv']);

const BY_COMMAND = new Map<string, AgentSpec>();
for (const spec of AGENTS) for (const command of spec.commands) BY_COMMAND.set(command, spec);

function identity(spec: AgentSpec): AgentIdentity {
  return { id: spec.id, name: spec.name };
}

/** `C:\x\Claude.EXE` → `claude`. */
function baseName(path: string, extensions: RegExp): string {
  const unquoted = path.trim().replace(/^["']|["']$/g, '');
  const base = unquoted.split(/[\\/]/).pop() ?? unquoted;
  return base.toLowerCase().replace(extensions, '');
}

const EXE_EXT = /\.(?:exe|cmd|bat|ps1)$/i;
const SCRIPT_EXT = /\.(?:exe|cmd|bat|ps1|js|mjs|cjs|ts|py|pyw)$/i;

function byExecutable(name: string): AgentSpec | null {
  const exact = BY_COMMAND.get(name);
  if (exact) return exact;
  return AGENTS.find((spec) => spec.prefixes?.some((prefix) => name.startsWith(prefix))) ?? null;
}

/** Split a command line on spaces outside double quotes; Windows and POSIX alike. */
export function tokenize(commandLine: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (const char of commandLine) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

function byScript(tokens: string[]): AgentSpec | null {
  // `python -m aider`
  const moduleFlag = tokens.indexOf('-m');
  if (moduleFlag > 0 && tokens[moduleFlag + 1]) {
    const spec = BY_COMMAND.get(tokens[moduleFlag + 1]!.split('.')[0]!.toLowerCase());
    if (spec) return spec;
  }
  const script = tokens.slice(1).find((token) => !token.startsWith('-'));
  if (!script) return null;
  const path = script.replace(/\\/g, '/').toLowerCase();
  for (const spec of AGENTS) {
    if (spec.packages?.some((pkg) => path.includes(`/node_modules/${pkg}/`) || path.includes(`/site-packages/${pkg}/`))) {
      return spec;
    }
  }
  return byExecutable(baseName(script, SCRIPT_EXT));
}

/**
 * The agent a process is, or null. `commandLine` may be null when it could not be read; a
 * wrapper (node, python) is then unknown rather than guessed.
 */
export function recognizeAgent(processName: string, commandLine: string | null): AgentIdentity | null {
  const name = baseName(processName, EXE_EXT);
  if (WRAPPERS.has(name)) {
    if (!commandLine) return null;
    const spec = byScript(tokenize(commandLine));
    return spec ? identity(spec) : null;
  }
  const spec = byExecutable(name);
  return spec ? identity(spec) : null;
}

/** True when a process's command line must be read before it can be recognised. */
export function needsCommandLine(processName: string): boolean {
  return WRAPPERS.has(baseName(processName, EXE_EXT));
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  name: string;
  /** Null when not read (non-wrapper processes on Windows). */
  command: string | null;
}

/** Every process under `root`, nearest first. Guards against pid reuse cycles. */
export function descendants(rows: readonly ProcessRow[], root: number): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    if (row.pid === row.ppid) continue;
    const list = children.get(row.ppid) ?? [];
    list.push(row);
    children.set(row.ppid, list);
  }
  const out: ProcessRow[] = [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      out.push(child);
      queue.push(child.pid);
    }
  }
  return out;
}

/** The agent running under a shell: the one nearest the shell, so sub-agents do not win. */
export function agentUnder(rows: readonly ProcessRow[], shellPid: number): AgentIdentity | null {
  for (const row of descendants(rows, shellPid)) {
    const agent = recognizeAgent(row.name, row.command);
    if (agent) return agent;
  }
  return null;
}
