import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Code editors a project can be opened in from the sidebar's right-click menu: the ones whose
 * command-line launcher is on PATH, as VS Code's `code` is once "Shell Command: Install" has run.
 */

export interface Editor {
  id: string;
  label: string;
}

const EDITORS: readonly (Editor & { command: string })[] = [
  { id: 'vscode', label: 'VS Code', command: 'code' },
  { id: 'cursor', label: 'Cursor', command: 'cursor' },
  { id: 'windsurf', label: 'Windsurf', command: 'windsurf' },
  { id: 'zed', label: 'Zed', command: 'zed' },
];

function onPath(command: string): string | null {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', '.bat'] : [''];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, command + suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

let cached: (Editor & { path: string })[] | null = null;

function found(): (Editor & { path: string })[] {
  cached ??= EDITORS.flatMap((editor) => {
    const path = onPath(editor.command);
    return path ? [{ id: editor.id, label: editor.label, path }] : [];
  });
  return cached;
}

export function availableEditors(): Editor[] {
  return found().map(({ id, label }) => ({ id, label }));
}

export function isFolder(path: unknown): path is string {
  if (typeof path !== 'string' || path === '') return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Launch the editor on `folder`, detached so it outlives nothing of ours. */
export function openInEditor(editorId: string, folder: string): void {
  const editor = found().find((e) => e.id === editorId);
  if (!editor) throw new Error(`${editorId} is not installed`);
  // `.cmd` launchers need a shell on Windows; quote both so spaces in paths survive.
  const child =
    process.platform === 'win32'
      ? spawn(`"${editor.path}" "${folder}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(editor.path, [folder], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}
