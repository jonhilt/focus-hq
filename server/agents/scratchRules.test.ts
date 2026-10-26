import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { insideScratch, scratchRmDenial, scratchRmTargets } from './scratchRules';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-scratch-rules-test-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const realpath = fs.realpathSync.native;

// a scratch dir with a folder in it, a symlink out of it, one to a folder inside it, and an outside folder to aim at
const scratch = path.join(tmp, 'scratch');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(path.join(scratch, 'probe'), { recursive: true });
fs.mkdirSync(outside);
fs.symlinkSync(outside, path.join(scratch, 'out'));
fs.symlinkSync(path.join(scratch, 'probe'), path.join(scratch, 'in'));

describe('scratchRmTargets', () => {
  it('reads the paths of an rm that only touches the scratch dir', () => {
    expect(scratchRmTargets('rm -rf "$FOCUS_SCRATCH/x"')).toEqual(['x']);
    expect(scratchRmTargets('rm -rf $FOCUS_SCRATCH/x/y.ts')).toEqual(['x/y.ts']);
    expect(scratchRmTargets('rm -r -f "${FOCUS_SCRATCH}/a b" $FOCUS_SCRATCH/c/')).toEqual(['a b', 'c/']);
  });

  it('leaves anything else to the other checks', () => {
    for (const command of [
      'rm -rf .qa-tmp',
      'rm -rf "$FOCUS_SCRATCH/x" ~',
      'rm -rf "$FOCUS_SCRATCH/x" /',
      'git status; rm -rf "$FOCUS_SCRATCH/x"',
      'rm -rf "$FOCUS_SCRATCH/x" && rm -rf /',
      'rm -rf "$FOCUS_SCRATCH"',
      'rm -rf "$FOCUS_SCRATCH/"',
      'rm -rf "$FOCUS_SCRATCH/$(echo /)"',
      'rm -rf "$FOCUS_SCRATCH/$HOME"',
      'rm -rf "$FOCUS_SCRATCH/*"',
      'rm -rf $FOCUS_SCRATCH/x;rm -rf /',
      'rm -rf ${FOCUS_SCRATCH/tmp/Users}/x',
      'rm -rf "$FOCUS_SCRATCHY/x"',
    ]) expect(scratchRmTargets(command), command).toBeNull();
  });
});

describe('insideScratch', () => {
  it('takes paths in the dir, there yet or not', () => {
    expect(insideScratch('probe', scratch, realpath)).toBe(true);
    expect(insideScratch('probe/new/deeper', scratch, realpath)).toBe(true);
    expect(insideScratch('./probe/', scratch, realpath)).toBe(true);
    expect(insideScratch('in/x', scratch, realpath)).toBe(true);
  });

  it('refuses .. anywhere, even when it would land back inside', () => {
    expect(insideScratch('..', scratch, realpath)).toBe(false);
    expect(insideScratch('../outside', scratch, realpath)).toBe(false);
    expect(insideScratch('probe/../../outside', scratch, realpath)).toBe(false);
    expect(insideScratch('probe/..', scratch, realpath)).toBe(false);
  });

  it('refuses symlinks that lead out of it', () => {
    expect(insideScratch('out', scratch, realpath)).toBe(false);
    expect(insideScratch('out/', scratch, realpath)).toBe(false);
    expect(insideScratch('out/anything', scratch, realpath)).toBe(false);
  });

  it('refuses the dir itself, and a dir that is not there', () => {
    expect(insideScratch('.', scratch, realpath)).toBe(false);
    expect(insideScratch('x', path.join(tmp, 'missing'), realpath)).toBe(false);
  });

  it('finds the dir where its own path runs through a symlink', () => {
    const link = path.join(tmp, 'link-to-scratch');
    fs.symlinkSync(scratch, link);
    expect(insideScratch('probe', link, realpath)).toBe(true);
    expect(insideScratch('out/x', link, realpath)).toBe(false);
  });
});

describe('scratchRmDenial', () => {
  it('lets a scratch rm through, and says which paths reach outside', () => {
    expect(scratchRmDenial('rm -rf "$FOCUS_SCRATCH/probe"', scratch, realpath)).toBeNull();
    expect(scratchRmDenial('rm -rf "$FOCUS_SCRATCH/probe" "$FOCUS_SCRATCH/out/x"', scratch, realpath)).toContain('$FOCUS_SCRATCH/out/x isn\'t inside');
    expect(scratchRmDenial('rm -rf $FOCUS_SCRATCH/../outside', scratch, realpath)).toContain('$FOCUS_SCRATCH/../outside');
  });

  it('has nothing to say about other commands', () => {
    expect(scratchRmDenial('rm -rf /', scratch, realpath)).toBeNull();
    expect(scratchRmDenial('git status', scratch, realpath)).toBeNull();
  });
});
