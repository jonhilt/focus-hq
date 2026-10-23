import { describe, expect, it } from 'vitest';
import { checkTemplate, parseTemplate, renderTemplate, TemplateError } from './crewTemplate';

const render = (src: string, values: Record<string, string | boolean>) => renderTemplate(parseTemplate(src), values);

describe('crew templates', () => {
  it('fills in text, and keeps a section by its flag', () => {
    expect(render('Hi {{name}}{{#cloud}}, in the cloud{{/cloud}}{{^cloud}}, here{{/cloud}}.', { name: 'Ada', cloud: true })).toBe('Hi Ada, in the cloud.');
    expect(render('Hi {{name}}{{#cloud}}, in the cloud{{/cloud}}{{^cloud}}, here{{/cloud}}.', { name: 'Ada', cloud: false })).toBe('Hi Ada, here.');
  });

  it('takes a section tag’s line with it when the tag has the line to itself, so no blank lines are left', () => {
    const src = 'a\n{{#on}}\n- on\n{{/on}}\n  {{^on}}  \n- off\n{{/on}}\nz\n';
    expect(render(src, { on: true })).toBe('a\n- on\nz\n');
    expect(render(src, { on: false })).toBe('a\n- off\nz\n');
  });

  it('keeps a text tag’s line, alone on it or not', () => {
    expect(render('a\n{{x}}\nz', { x: '' })).toBe('a\n\nz');
  });

  it('never reads what it fills in as a template', () => {
    expect(render('{{x}}', { x: '{{y}}' })).toBe('{{y}}');
  });

  it('names the line of a tag it can’t read, or a section left open or closed wrongly', () => {
    const line = (src: string) => {
      try {
        parseTemplate(src, 10);
      } catch (err) {
        if (err instanceof TemplateError) return [err.line, err.message];
      }
      return undefined;
    };
    expect(line('a\nb {{ two words }}')).toEqual([11, expect.stringContaining("isn't a tag")]);
    expect(line('a\n{{#on}}\nb')).toEqual([11, expect.stringContaining('never closed')]);
    expect(line('{{#on}}\n{{/off}}')).toEqual([11, expect.stringContaining('closes {{#on}} (line 10)')]);
    expect(line('a\n\n{{/on}}')).toEqual([12, expect.stringContaining('never opened')]);
  });

  it('refuses a name its role hasn’t got, or one used as the other kind', () => {
    const vars = { name: 'text', cloud: 'flag' } as const;
    expect(checkTemplate(parseTemplate('{{name}}{{#cloud}}x{{/cloud}}'), vars)).toBeUndefined();
    expect(checkTemplate(parseTemplate('a\n{{#cloud}}{{nmae}}{{/cloud}}'), vars)?.message).toBe("{{nmae}} isn't something this role's prompt can refer to: it has name, cloud");
    expect(checkTemplate(parseTemplate('{{cloud}}'), vars)?.message).toContain('cloud is a flag');
    expect(checkTemplate(parseTemplate('{{^name}}x{{/name}}'), vars)?.message).toContain('name is text');
  });
});
