import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TaskView } from '@osade/contract';

// Must be hoisted before cli.ts imports it
vi.mock('../src/client.js', () => ({
  OsadeCliError: class extends Error {},
  api: { taskList: vi.fn(), taskGet: vi.fn() },
}));

import { main, type Io } from '../src/cli.js';
import { api } from '../src/client.js';

function capture() {
  const stdout:string[]=[]; const stderr:string[]=[];
  return { stdout, stderr,
    out:(t:string)=>void stdout.push(t),
    err:(t:string)=>void stderr.push(t) } as Io & {stdout:string[],stderr:string[]};
}

const view = (over: Partial<TaskView> = {}) => ({
    task: {
      id: 't_123',
      title: 'a very long title that would be truncated at 34 chars in table mode',
    },
    status:'queued', agent:null, scm:null, openGates:[],
    latestVerifyRuns:[], needsYou:false, chatId:'c1',
    agentId:'a1', attachment:'repo', branch:'osade/x', cwd:'/wt',
    ...over,
  } as unknown as TaskView);

beforeEach(()=>vi.clearAllMocks());

describe('task list --json',()=>{
  it('parses as JSON array with full titles',async()=>{
    vi.mocked(api.taskList).mockResolvedValue([view()]);
    const io=capture();
    expect(await main(['task','list','--json'],io)).toBe(0);
    const parsed=JSON.parse(io.stdout.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].task.title).toContain('truncated');
    expect(io.stderr.join('')).toBe('');
  });
  it('unchanged without flag',async()=>{
    vi.mocked(api.taskList).mockResolvedValue([view()]);
    const io=capture();
    await main(['task','list'],io);
    expect(()=>JSON.parse(io.stdout.join(''))).toThrow();
    expect(io.stdout.join('')).toContain('t_123');
  });
});

describe('task show --json',()=>{
  it('parses as single TaskView, flag before or after id',async()=>{
    vi.mocked(api.taskGet).mockResolvedValue(view());
    for(const args of [['task','show','--json','t_123'],['task','show','t_123','--json']]){
      const io=capture();
      expect(await main(args,io)).toBe(0);
      expect(JSON.parse(io.stdout.join(''))).toMatchObject({ status: 'queued' });
    }
  });
  it('uses OSADE_TASK_ID with --json and no id',async()=>{
    process.env.OSADE_TASK_ID='t_123';
    vi.mocked(api.taskGet).mockResolvedValue(view());
    const io=capture();
    await main(['task','show','--json'],io);
    expect(vi.mocked(api.taskGet)).toHaveBeenCalledWith('t_123');
    delete process.env.OSADE_TASK_ID;
  });
});