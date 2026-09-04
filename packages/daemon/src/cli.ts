/**
 * The daemon's own entrypoint — OSADE.md §20.1.
 *
 * This is the ONE file in `daemon/src/**` allowed `console.*` and `process.exit`. It stays off
 * the server import graph: the runtime is loaded with a lazy `await import(...)` inside
 * `main`, so a short-lived subcommand does not eagerly pull in sqlite, herdr and the whole
 * stack and then stay alive after printing its result. That was a real bug in Kanban.
 */

async function main(argv: string[]): Promise<number> {
  const command = argv[0] ?? 'start';

  switch (command) {
    case 'start': {
      const { startDaemon } = await import('./index.js');
      const portFlag = argv.indexOf('--port');
      const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : undefined;

      const daemon = await startDaemon({
        port,
        onInfo: (m) => console.log(m),
        onWarning: (m) => console.warn(`warning: ${m}`),
      });

      const shutdown = async () => {
        // §18.1 — quitting detaches. It does not stop herdr and does not stop agents.
        console.log('osade daemon detaching; agents keep running');
        await daemon.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());

      // Hold the process open on the listener.
      return new Promise<number>(() => {});
    }

    case 'drift': {
      const { assertNoDrift, HerdrDriftError } = await import('./herdr/drift-check.js');
      try {
        const result = await assertNoDrift(argv[1] ?? 'herdr');
        console.log(result.ok ? `ok: ${result.message}` : `warning: ${result.message}`);
        return 0;
      } catch (err) {
        console.error(
          `fatal: ${err instanceof HerdrDriftError ? err.message : (err as Error).message}`,
        );
        return 1;
      }
    }

    case 'help':
    case '--help':
    case '-h': {
      console.log(
        [
          'osade-daemon — the Osade background service',
          '',
          'Usage:',
          '  osade-daemon start [--port N]   run the daemon (default)',
          '  osade-daemon drift [path]       run the herdr boot drift check',
          '',
          'The daemon binds 127.0.0.1 only and writes its port to ~/.osade/daemon.port.',
        ].join('\n'),
      );
      return 0;
    }

    default:
      console.error(`unknown command: ${command}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err: Error) => {
    console.error(`fatal: ${err.message}`);
    process.exit(1);
  },
);
