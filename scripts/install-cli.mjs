#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Put `osade` on PATH from this source checkout.
 *
 * One command, Windows first: `node scripts/install-cli.mjs`
 *
 * Shims live under `~/.osade/bin` (§2.2). They point at this checkout's built CLI, so `osade .`
 * launches the window the way `code .` launches Code, and `osade task list` still talks to the
 * daemon.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(process.env.OSADE_HOME ?? join(homedir(), '.osade'), 'bin');
const cliJs = join(root, 'packages', 'cli', 'dist', 'bin.js');
const nodeBin = process.execPath;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.stderr.write(`failed: ${command} ${args.join(' ')}\n`);
    process.exit(result.status ?? 1);
  }
}

function build() {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  if (!existsSync(cliJs)) run(pnpm, ['--filter', '@osade/cli', 'build']);
  const daemonJs = join(root, 'packages', 'daemon', 'dist', 'cli.js');
  if (!existsSync(daemonJs)) run(pnpm, ['--filter', '@osade/daemon', 'build']);
  const electronJs = join(root, 'apps', 'desktop', 'dist', 'main', 'electron.js');
  if (!existsSync(electronJs)) run(pnpm, ['--filter', '@osade/desktop', 'build']);
}

function quote(path) {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function writeShims() {
  mkdirSync(binDir, { recursive: true });

  const quotedNode = quote(nodeBin);
  const quotedCli = quote(cliJs);

  writeFileSync(join(binDir, 'osade.cmd'), `@echo off\r\n${quotedNode} ${quotedCli} %*\r\n`, 'utf8');

  const shPath = join(binDir, 'osade');
  writeFileSync(shPath, `#!/bin/sh\nexec ${quotedNode} ${quotedCli} "$@"\n`, 'utf8');
  try {
    chmodSync(shPath, 0o755);
  } catch {
    // Windows has no chmod to speak of; osade.cmd is the one cmd.exe finds.
  }
}

function addToWindowsUserPath(dir) {
  const script = [
    `$dir = '${dir.replace(/'/g, "''")}'`,
    `$user = [Environment]::GetEnvironmentVariable('Path', 'User')`,
    `if ([string]::IsNullOrEmpty($user)) { $user = '' }`,
    `$parts = @($user.Split(';') | Where-Object { $_ -and $_.Trim() -ne '' })`,
    `if ($parts -contains $dir) { return }`,
    `$next = if ($user.Trim() -eq '') { $dir } else { $user.TrimEnd(';') + ';' + $dir }`,
    `[Environment]::SetEnvironmentVariable('Path', $next, 'User')`,
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
}

function addToUnixPath(dir) {
  const line = `export PATH="${dir}:$PATH"`;
  const home = homedir();
  for (const name of ['.zshrc', '.bashrc', '.profile']) {
    const file = join(home, name);
    let current = '';
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      if (name !== '.profile') continue;
    }
    if (current.includes(dir)) continue;
    const prefix = current.length === 0 || current.endsWith('\n') ? '' : '\n';
    appendFileSync(file, `${prefix}# osade\n${line}\n`);
  }
}

build();
writeShims();
if (process.platform === 'win32') addToWindowsUserPath(binDir);
else addToUnixPath(binDir);

const shim = join(binDir, process.platform === 'win32' ? 'osade.cmd' : 'osade');
process.stdout.write(`installed ${shim}\n`);
process.stdout.write('open a new terminal, then: osade .\n');
