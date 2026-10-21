import { describe, expect, it } from 'vitest';
import { lend, lentLog } from './lend';

describe('lend', () => {
  it('hands a copy, so what a plugin changes never reaches Focus', () => {
    const agent = { id: 'a', lead: { prs: [1] } };
    const copy = lend(agent);
    copy.lead.prs.push(2);
    expect(agent.lead.prs).toEqual([1]);
  });
});

describe('lentLog', () => {
  it('copies only the lines added since, and the whole log again when it starts afresh', () => {
    let log = [{ n: 1 }, { n: 2 }];
    const read = lentLog(() => log);
    const first = read();
    first[0].n = 99;
    first.push({ n: 3 });
    log.push({ n: 3 });
    // its copy keeps what it did to it; Focus's log is untouched
    expect(read()).toEqual([{ n: 99 }, { n: 2 }, { n: 3 }]);
    expect(log[0].n).toBe(1);
    log = [{ n: 7 }];
    expect(read()).toEqual([{ n: 7 }]);
  });
});
