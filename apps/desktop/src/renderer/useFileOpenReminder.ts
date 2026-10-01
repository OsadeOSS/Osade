import { useEffect, useState } from 'react';

import type { QuickNoteView } from '@osade/contract';

import { api } from './api.js';

/**
 * The passive reminder — issue #19's "open a file you left a note on".
 *
 * It is a banner, not a toast and not a chat message, and that is the whole design. The failure
 * mode this feature has to avoid is a note that interrupts: a note that pops up over the code
 * you are trying to read has defeated the purpose of writing the note down instead of fixing
 * it. So it appears where the file already is, says one sentence, and offers one way out.
 *
 * **One query for one answer.** This asks the daemon `noteForFile` rather than pulling every
 * open note and picking through them here. Beyond the obvious saving, it is the only version
 * that is correct at the moment it matters: a client-side filter over a cached list shows a
 * note that was resolved a moment ago, because nothing told the list it had changed.
 *
 * `revision` re-runs the lookup after a note is written or resolved elsewhere, which is what
 * makes ticking a note off in the Notes lane also retire the banner it is currently showing.
 *
 * Dismissal is local to this hook, so reopening the same file in the same lane does not bring
 * back a banner you just closed — the difference between a reminder and an irritation.
 */
export function useFileOpenReminder(
  repoId: string,
  file: string | null,
  revision = 0,
): { note: QuickNoteView | null; dismiss: () => void } {
  const [note, setNote] = useState<QuickNoteView | null>(null);

  useEffect(() => {
    if (file == null || file === '') {
      setNote(null);
      return;
    }
    let cancelled = false;
    void api
      .noteForFile(repoId, file)
      .then((found) => {
        if (cancelled) return;
        setNote((current) => {
          // Already showing this one for this file: leave it, do not re-announce.
          if (current != null && current.id === found?.id) return current;
          return found;
        });
      })
      .catch(() => {
        // A reminder is never worth an error banner. If the daemon is unreachable, stay quiet.
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, file, revision]);

  return {
    note,
    dismiss: () => setNote(null),
  };
}
