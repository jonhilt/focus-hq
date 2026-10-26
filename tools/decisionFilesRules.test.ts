import { describe, expect, it } from 'vitest';
import { ioChain, type Edge } from './decisionFilesRules';

const file = (to: string): Edge => ({ kind: 'file', to });
const pkg = (to: string): Edge => ({ kind: 'package', to });
const graph = (edges: Record<string, Edge[]>) => (f: string) => edges[f] ?? [];

describe('ioChain', () => {
  it('passes a file whose imports are all pure, packages included', () => {
    expect(ioChain('a.ts', graph({ 'a.ts': [file('b.ts'), pkg('effect'), pkg('node:path')], 'b.ts': [pkg('typescript')] }))).toBeUndefined();
  });

  it('finds the file system through a barrel, naming each file on the way', () => {
    const g = graph({ 'aRules.ts': [file('shared/x.ts'), file('plugin-api/server.ts')], 'plugin-api/server.ts': [file('server/util.ts')], 'server/util.ts': [pkg('node:child_process')] });
    expect(ioChain('aRules.ts', g)).toEqual(['aRules.ts', 'plugin-api/server.ts', 'server/util.ts', 'node:child_process']);
  });

  it('takes the shortest way there', () => {
    const g = graph({ 'a.ts': [file('long.ts'), file('short.ts')], 'long.ts': [file('longer.ts')], 'longer.ts': [pkg('fs')], 'short.ts': [pkg('node:fs')] });
    expect(ioChain('a.ts', g)).toEqual(['a.ts', 'short.ts', 'node:fs']);
  });

  it('counts the store as I/O, and an I/O package imported straight away', () => {
    expect(ioChain('a.ts', graph({ 'a.ts': [file('server/store.ts')] }))).toEqual(['a.ts', 'server/store.ts']);
    expect(ioChain('a.ts', graph({ 'a.ts': [pkg('express')] }))).toEqual(['a.ts', 'express']);
  });

  it('walks a cycle once', () => {
    expect(ioChain('a.ts', graph({ 'a.ts': [file('b.ts')], 'b.ts': [file('a.ts')] }))).toBeUndefined();
  });
});
