import { useState, type JSX } from 'react';
import { createPortal } from 'react-dom';

import { Changes } from './Changes.js';
import { Conventions } from './Conventions.js';
import { PanelTabs, type PanelLane } from './Detail.js';
import { Files } from './Files.js';
import { QuickNotes } from './QuickNotesPanel.js';
import { repoTarget } from './work-target.js';

/**
 * The right panel for a terminal tab: Files, Changes, Rules and Notes of the project folder the
 * terminal was opened in — what an agent started there by hand is editing. A chat gets the same
 * panel from `Detail`, but reads its lane's checkout instead.
 *
 * A file or diff picked here opens over the terminal, like an editor tab in Orca; the Terminal
 * chip goes back. The terminal itself stays mounted underneath, so nothing it was running is lost.
 */
export function TerminalWorkspace({
  repoId,
  panel,
  onPanel,
  panelHost,
  notesVersion,
  onCaptureNote,
}: {
  repoId: string;
  panel: PanelLane;
  onPanel: (panel: PanelLane) => void;
  panelHost: HTMLElement | null;
  notesVersion: number;
  onCaptureNote: () => void;
}): JSX.Element {
  const [viewer, setViewer] = useState<'file' | 'diff' | null>(null);
  const [opened, setOpened] = useState({ file: false, diff: false });
  const [fileHost, setFileHost] = useState<HTMLDivElement | null>(null);
  const [diffHost, setDiffHost] = useState<HTMLDivElement | null>(null);
  // Files and Changes stay mounted once visited: their viewers live in the centre.
  const [seen, setSeen] = useState({ files: false, diff: false });
  const [noteTarget, setNoteTarget] = useState<{ file: string; line: number | null; n: number } | null>(null);
  if (panel === 'files' && !seen.files) setSeen({ ...seen, files: true });
  if (panel === 'diff' && !seen.diff) setSeen({ ...seen, diff: true });

  const target = repoTarget(repoId);
  const show = (which: 'file' | 'diff') => (): void => {
    setOpened((current) => ({ ...current, [which]: true }));
    setViewer(which);
  };

  return (
    <>
      <div className="terminal-viewer" style={{ display: viewer ? 'flex' : 'none' }}>
        <div className="center-switch">
          <Chip label="Terminal" active={false} onClick={() => setViewer(null)} />
          {opened.file && <Chip label="File" active={viewer === 'file'} onClick={show('file')} />}
          {opened.diff && <Chip label="Diff" active={viewer === 'diff'} onClick={show('diff')} />}
        </div>
        <div ref={setFileHost} className="center-viewer" style={{ display: viewer === 'file' ? 'flex' : 'none' }} />
        <div ref={setDiffHost} className="center-viewer" style={{ display: viewer === 'diff' ? 'flex' : 'none' }} />
      </div>

      {panelHost &&
        createPortal(
          <>
            <PanelTabs panel={panel} onPanel={onPanel} />
            <div
              className="right-panel-body"
              style={{
                overflow: panel === 'files' || panel === 'diff' ? 'hidden' : 'auto',
                padding: panel === 'files' || panel === 'diff' ? 0 : 16,
              }}
            >
              {seen.files && (
                <div className="right-panel-pane" style={{ display: panel === 'files' ? 'flex' : 'none' }}>
                  <Files target={target} openPath={noteTarget} viewerHost={fileHost} onShow={show('file')} />
                </div>
              )}
              {panel === 'checks' && (
                <p className="right-panel-empty">
                  Checks run for chat lanes. A terminal tab has no verify plan; run your checks in it.
                </p>
              )}
              {seen.diff && (
                <div className="right-panel-pane" style={{ display: panel === 'diff' ? 'flex' : 'none' }}>
                  <Changes target={target} viewerHost={diffHost} onShow={show('diff')} />
                </div>
              )}
              {panel === 'rules' && <Conventions repoId={repoId} />}
              {panel === 'notes' && (
                <QuickNotes
                  repoId={repoId}
                  refreshKey={notesVersion}
                  onCapture={onCaptureNote}
                  onOpenFile={(file, line) => {
                    setNoteTarget({ file, line, n: (noteTarget?.n ?? 0) + 1 });
                    onPanel('files');
                  }}
                />
              )}
            </div>
          </>,
          panelHost,
        )}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className="chip" aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
}
