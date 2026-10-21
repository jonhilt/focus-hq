// A state chart's page: the house style's sections, its legibility fixes, its cites checked and shown repo-relative.
import { describe, expect, it } from 'vitest';
import type { Statechart } from './statechart';
import { checkCite, checkCites, statechartPage } from './statechartPage';
import { exampleChart } from './statechartExample';

const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const read = (file: string) => (file.startsWith('/w/') ? ten : undefined);

describe('a cite', () => {
  it('is shown relative to its checkout, and checks out when the file has the line', () => {
    expect(checkCite({ file: '/w/src/a.ts', line: 3 }, [{ repo: 'o/r', dir: '/w' }], read)).toEqual({ shown: 'src/a.ts:3' });
  });

  it('names its repo when the lead has more than one', () => {
    expect(checkCite({ file: '/w/src/a.ts', line: 3 }, [{ repo: 'o/api', dir: '/v' }, { repo: 'o/r', dir: '/w' }], read).shown).toBe('r/src/a.ts:3');
  });

  it('says why when there\'s no such line, or no such file', () => {
    expect(checkCite({ file: '/w/a.ts', line: 11 }, [{ repo: 'o/r', dir: '/w' }], read)).toEqual({ shown: 'a.ts:11', problem: 'a.ts has only 10 lines, so no line 11' });
    expect(checkCite({ file: '/elsewhere/a.ts', line: 1 }, [{ repo: 'o/r', dir: '/w' }], read).problem).toBe("/elsewhere/a.ts isn't there (or isn't in one of your checkouts)");
  });

  it('that fails is said where it\'s cited, and drawn flagged', () => {
    const c = exampleChart('/w');
    const { cites, problems } = checkCites(c, (cite) => checkCite(cite, [{ repo: 'o/r', dir: '/w' }], read));
    expect(problems).toEqual([
      'Trigger "Turn ends → read": plugins/chief-of-staff/chief.ts has only 10 lines, so no line 37.',
      'Trigger "Send the words": plugins/chief-of-staff/chief.ts has only 10 lines, so no line 32.',
      'Trigger "Send the words": plugins/chief-of-staff/chief.ts has only 10 lines, so no line 9999.',
      'Risk R1: plugins/chief-of-staff/chief.ts has only 10 lines, so no line 37.',
      'Risk R2: plugins/chief-of-staff/turn.ts has only 10 lines, so no line 16.',
    ]);
    const html = statechartPage(c, cites);
    expect(html).toContain('<code class="flag" title="plugins/chief-of-staff/chief.ts has only 10 lines, so no line 9999">plugins/chief-of-staff/chief.ts:9999 (not found)</code>');
  });
});

describe('the page', () => {
  const page = statechartPage(exampleChart('/w'));

  it('has every section the chart has data for, numbered in order', () => {
    expect([...page.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1])).toEqual(['1. The flow', '2. Trigger table', '3. Properties worth checking', '4. What already looks breakable', '5. Open for you', '6. Formal check']);
  });

  it('leaves out the sections it has nothing for, and key entries it doesn\'t use', () => {
    const bare: Statechart = { title: 'T', source: 'S', nodes: [{ id: 'a', text: 'A', kind: 'works' }], edges: [] };
    const html = statechartPage(bare);
    expect([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1])).toEqual(['1. The flow']);
    expect(html).toContain('>Works</span>');
    expect(html).not.toContain('>Bug</span>');
    expect(html).not.toContain('Actors:');
  });

  it('draws with mermaid 11 and keeps the legibility fixes', () => {
    expect(page).toContain('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js');
    expect(page).toContain("mermaid.initialize({startOnLoad:false,theme:'default',themeVariables:{edgeLabelBackground:'#ffffff',fontFamily:'Helvetica,Arial,sans-serif',fontSize:'15px'},flowchart:{curve:'step',rankSpacing:55,nodeSpacing:28,wrappingWidth:280,padding:12}})");
    expect(page).toContain('.mermaid .flowchart-link{stroke:#333!important;stroke-width:1.5px!important}.mermaid marker path{fill:#333!important;stroke:#333!important}');
    // the zero-length segment mermaid's step curve ends an edge on, dropped so its arrowhead points straight
    expect(page).toContain(String.raw`matchAll(/(-?[\d.]+),(-?[\d.]+)/g)`);
    expect(page).toContain('Math.hypot(q[0]-pts[i-1][0],q[1]-pts[i-1][1])>0.5');
  });

  it('escapes what the lead wrote', () => {
    const c: Statechart = { ...exampleChart('/w'), title: '<script>alert(1)</script>', open: ['a & b < c'] };
    const html = statechartPage(c);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>');
    expect(html).toContain('<li>a &amp; b &lt; c</li>');
  });

  it('colours actors, statuses and severities', () => {
    expect(page).toContain('<span class="pill s">chief of staff</span>');
    expect(page).toContain('<span class="bad">broken: a merge conflict does (R2)</span>');
    expect(page).toContain('<td class="hi">R1</td>');
  });
});
