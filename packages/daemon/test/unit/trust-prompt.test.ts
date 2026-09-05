import { describe, expect, it } from 'vitest';

import { trustSelection } from '../../src/domain/launch-task.js';

/**
 * §8.3 — reading the trust prompt's selection.
 *
 * This function decides whether Osade is about to press Enter on "Yes, I trust this folder" or
 * on "No, exit". Getting it wrong once already cost a launch: a dropped `Down` keystroke left
 * the default selected, `Enter` declined the folder, and Claude quit — which surfaced as an
 * intermittent 90-second timeout rather than as what it was.
 */

/** The real prompt, as captured from a live pane. */
const LIVE_PROMPT_DEFAULT = `
──────────────────────────────────────────────
 Accessing workspace:

 C:\\Users\\x\\worktrees\\repo\\t_1

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a
 well-known open source project, or work from your team).

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;

const LIVE_PROMPT_MOVED = LIVE_PROMPT_DEFAULT.replace(
  ' ❯ No, exit\n   Yes, I trust this folder',
  '   No, exit\n ❯ Yes, I trust this folder',
);

describe('§8.3 — trustSelection', () => {
  it('reads the default selection as decline, not trust', () => {
    // The consequential case: assuming the default is safe is how you press Enter on "No".
    expect(trustSelection(LIVE_PROMPT_DEFAULT)).toBe('decline');
  });

  it('reads the moved selection as trust', () => {
    expect(trustSelection(LIVE_PROMPT_MOVED)).toBe('trust');
  });

  it('returns null when no prompt is on screen', () => {
    expect(trustSelection('PS C:\\repo> \n')).toBe(null);
    expect(trustSelection('')).toBe(null);
  });

  it('returns null for stale scrollback — options with no live selector', () => {
    // After the prompt is answered the text can linger. Acting on it again would send keys
    // into a running agent.
    const answered = LIVE_PROMPT_DEFAULT.replace(' ❯ No, exit', '   No, exit');
    expect(trustSelection(answered)).toBe(null);
  });

  it('accepts a plain ">" marker as well as "❯"', () => {
    const ascii = LIVE_PROMPT_DEFAULT.replace(' ❯ No, exit', ' > No, exit');
    expect(trustSelection(ascii)).toBe('decline');
  });

  it('is case-insensitive about the option wording', () => {
    const shouty = LIVE_PROMPT_MOVED.replace('Yes, I trust this folder', 'YES, I TRUST THIS FOLDER');
    expect(trustSelection(shouty)).toBe('trust');
  });

  it('is not fooled by the words appearing in prose', () => {
    const prose = 'The agent explained that you should say yes, I trust this kind of thing.\n';
    expect(trustSelection(prose)).toBe(null);
  });
});
