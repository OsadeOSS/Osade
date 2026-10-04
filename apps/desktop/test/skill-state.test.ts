import { describe, expect, it } from 'vitest';

import {
  activeSkillsFromTask,
  skillStateFromText,
  stripSkillState,
} from '../src/renderer/skill-state.js';

describe('skill state marker', () => {
  it('reads the last declaration, normalizes names, and removes duplicates', () => {
    expect(
      skillStateFromText(
        '<osade_skills>prime-agent</osade_skills>\nwork\n' +
          '<osade_skills>Graph-Engineering, loop-engineering, graph-engineering</osade_skills>',
      ),
    ).toEqual(['graph-engineering', 'loop-engineering']);
  });

  it('keeps the marker out of conversation prose', () => {
    expect(
      stripSkillState(
        '<osade_skills>loop-engineering</osade_skills>\n\nRunning the focused test.',
      ),
    ).toBe('Running the focused test.');
  });

  it('lets a live declaration replace or clear the settled selection', () => {
    const task = {
      turns: [
        {
          seq: 1,
          role: 'agent' as const,
          text: '<osade_skills>graph-engineering</osade_skills>',
        },
      ],
      agent: {
        final_message: null,
        stream_text: '<osade_skills>loop-engineering</osade_skills>\nImplementing.',
      },
    };
    expect(activeSkillsFromTask(task)).toEqual(['loop-engineering']);
    expect(
      activeSkillsFromTask({ ...task, agent: { ...task.agent, stream_text: '<osade_skills></osade_skills>' } }),
    ).toEqual([]);
  });
});
