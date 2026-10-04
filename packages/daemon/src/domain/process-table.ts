import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { descendants, needsCommandLine, type ProcessRow } from './agent-process.js';

/**
 * The machine's process table, for finding what runs under a terminal's shell.
 *
 * POSIX: one `ps`, which is cheap and includes command lines.
 *
 * Windows: a full `Win32_Process` CIM scan costs ~0.6 s and a fresh PowerShell another ~0.5 s,
 * too much to repeat every couple of seconds. So one PowerShell stays up and answers `scan` with a
 * Toolhelp32 snapshot (~30 ms, names and parents only), and `cmd <pids>` with command lines from
 * CIM — asked only for node/python processes under a shell, once per process, since a command line
 * never changes.
 */

const WINDOWS_WORKER = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OsadeProcessTable {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Entry {
    public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
    public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref Entry e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref Entry e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Rows() {
    var sb = new StringBuilder();
    IntPtr snap = CreateToolhelp32Snapshot(2, 0);
    var e = new Entry();
    e.dwSize = (uint)Marshal.SizeOf(typeof(Entry));
    if (Process32FirstW(snap, ref e)) {
      do {
        sb.Append(e.th32ProcessID).Append('\t').Append(e.th32ParentProcessID).Append('\t').Append(e.szExeFile).Append('\n');
      } while (Process32NextW(snap, ref e));
    }
    CloseHandle(snap);
    return sb.ToString();
  }
}
'@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'scan') {
    [Console]::Out.Write([OsadeProcessTable]::Rows())
  } elseif ($line.StartsWith('cmd ')) {
    $filter = (($line.Substring(4) -split ',') | ForEach-Object { "ProcessId=$([int]$_)" }) -join ' or '
    Get-CimInstance -ClassName Win32_Process -Filter $filter -Property ProcessId,CommandLine | ForEach-Object {
      [Console]::Out.Write([string]$_.ProcessId + [char]9 + (([string]$_.CommandLine) -replace '[\r\n\t]', ' ') + [char]10)
    }
  }
  [Console]::Out.Write('<<osade-end>>' + [char]10)
  [Console]::Out.Flush()
}
`;

const END = '<<osade-end>>\n';
const REQUEST_TIMEOUT_MS = 10_000;

class WindowsWorker {
  #child: ChildProcessWithoutNullStreams | null = null;
  #out = '';
  #waiting: { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  #chain: Promise<unknown> = Promise.resolve();

  /** One request at a time; the protocol has no ids. */
  request(line: string): Promise<string> {
    const next = this.#chain.then(() => this.#send(line));
    this.#chain = next.catch(() => undefined);
    return next;
  }

  #send(line: string): Promise<string> {
    const child = this.#ensure();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting = null;
        this.dispose();
        reject(new Error('process table timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.#waiting = { resolve, reject, timer };
      child.stdin.write(`${line}\n`);
    });
  }

  #ensure(): ChildProcessWithoutNullStreams {
    if (this.#child) return this.#child;
    const encoded = Buffer.from(WINDOWS_WORKER, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'pipe',
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.#out += chunk;
      const end = this.#out.indexOf(END);
      if (end === -1) return;
      const text = this.#out.slice(0, end);
      this.#out = this.#out.slice(end + END.length);
      const waiting = this.#waiting;
      this.#waiting = null;
      if (waiting) {
        clearTimeout(waiting.timer);
        waiting.resolve(text);
      }
    });
    child.stderr.resume();
    child.on('exit', () => {
      if (this.#child === child) this.#child = null;
      this.#out = '';
      const waiting = this.#waiting;
      this.#waiting = null;
      if (waiting) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error('process table exited'));
      }
    });
    child.on('error', () => undefined);
    this.#child = child;
    return child;
  }

  dispose(): void {
    const child = this.#child;
    this.#child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
  }
}

export function parseWindowsRows(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const [pid, ppid, name] = line.replace(/\r$/, '').split('\t');
    const p = Number(pid);
    const pp = Number(ppid);
    if (!name || !Number.isFinite(p) || !Number.isFinite(pp)) continue;
    rows.push({ pid: p, ppid: pp, name, command: null });
  }
  return rows;
}

/** `ps -A -o pid=,ppid=,args=` lines. */
export function parsePsRows(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const command = match[3]!.trim();
    const first = command.split(/\s+/)[0] ?? '';
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), name: first, command });
  }
  return rows;
}

export class ProcessTable {
  readonly #worker = process.platform === 'win32' ? new WindowsWorker() : null;
  /** Windows command lines by pid, kept while the same process (pid + name) is alive. */
  readonly #commands = new Map<number, { name: string; command: string }>();

  /** Rows for everything under `roots`, with command lines wherever recognition needs them. */
  async rowsUnder(roots: readonly number[]): Promise<ProcessRow[]> {
    if (!this.#worker) return this.#psRows();

    const rows = parseWindowsRows(await this.#worker.request('scan'));
    const live = new Set(rows.map((row) => row.pid));
    for (const pid of this.#commands.keys()) if (!live.has(pid)) this.#commands.delete(pid);

    const wanted = new Set<ProcessRow>();
    for (const root of roots) {
      for (const row of descendants(rows, root)) {
        if (!needsCommandLine(row.name)) continue;
        const cached = this.#commands.get(row.pid);
        if (cached && cached.name === row.name) row.command = cached.command;
        else wanted.add(row);
      }
    }
    if (wanted.size > 0) {
      const text = await this.#worker.request(`cmd ${[...wanted].map((row) => row.pid).join(',')}`);
      const byPid = new Map<number, string>();
      for (const line of text.split('\n')) {
        const tab = line.indexOf('\t');
        if (tab > 0) byPid.set(Number(line.slice(0, tab)), line.slice(tab + 1).replace(/\r$/, ''));
      }
      for (const row of wanted) {
        // An unreadable command line (another user's process) is cached as empty, not retried.
        const command = byPid.get(row.pid) ?? '';
        row.command = command || null;
        this.#commands.set(row.pid, { name: row.name, command });
      }
    }
    return rows;
  }

  #psRows(): Promise<ProcessRow[]> {
    return new Promise((resolve, reject) => {
      execFile('ps', ['-A', '-o', 'pid=,ppid=,args='], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(parsePsRows(stdout));
      });
    });
  }

  dispose(): void {
    this.#worker?.dispose();
    this.#commands.clear();
  }
}
