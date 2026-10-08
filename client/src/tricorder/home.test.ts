// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PullRequest, QaReview } from '../../../shared/types';
import { api } from '../net/api';
import { h } from '../ui/dom';
import { Actions, morph } from './actions';
import { mergeButton } from './home';

vi.mock('../net/api', () => ({ api: { mergePr: vi.fn(() => Promise.resolve()), mergeWhenPassed: vi.fn(() => Promise.resolve()) } }));

const HEAD = 'abc1234def5678';
const pr = { repo: 'demo/webshop-api', number: 7, title: 'Wishlist endpoints', headSha: HEAD, mergeable: 'MERGEABLE', isDraft: false } as PullRequest;
const review = (r: Partial<QaReview>): QaReview => ({ projectId: 'p', repo: pr.repo, number: pr.number, title: pr.title, status: 'testing', sha: HEAD, requestedAt: 0, ...r });

/** The card as the Tricorder keeps it: rendered once, then morphed to each new render, the way main.ts updates the page. */
function card(first: QaReview | undefined) {
  const actions = new Actions(() => undefined);
  const render = (r: QaReview | undefined) => h('div', null, mergeButton(actions, 'pr:p:demo/webshop-api#7', 'p', pr, r));
  const el = render(first);
  return {
    become: (r: QaReview | undefined) => morph(el, render(r)),
    click: () => {
      const button = el.querySelector('button')!;
      button.click();
      return button.textContent;
    },
  };
}

describe('the Tricorder’s merge button', () => {
  afterEach(() => vi.clearAllMocks());
  vi.stubGlobal('confirm', vi.fn(() => true));

  it('asks for the merge once QA passes when QA starts on a PR already on the page', () => {
    const c = card(undefined);
    c.become(review({ status: 'testing' }));
    expect(c.click()).toBe('⤵ Merge when QA passes');
    expect(api.mergeWhenPassed).toHaveBeenCalledWith('p', pr.repo, pr.number, true);
    expect(api.mergePr).not.toHaveBeenCalled();
  });

  it('merges straight away once QA has passed it', () => {
    const c = card(review({ status: 'queued', sha: undefined }));
    c.become(review({ status: 'passed' }));
    expect(c.click()).toBe('⤵ squash & merge');
    expect(api.mergePr).toHaveBeenCalledWith('p', pr.repo, pr.number);
    expect(api.mergeWhenPassed).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(`Merge ${pr.repo}#7 "${pr.title}"?`);
  });

  it('takes the request back while it’s waiting, and asks first when QA failed it', () => {
    const c = card(review({ status: 'testing' }));
    c.become(review({ status: 'testing', mergeRequested: { at: 1 } }));
    c.click();
    expect(api.mergeWhenPassed).toHaveBeenCalledWith('p', pr.repo, pr.number, false);

    const passed = card(review({ status: 'passed' }));
    passed.become(review({ status: 'failed' }));
    passed.click();
    expect(confirm).toHaveBeenLastCalledWith(`QA failed it.\n\nMerge ${pr.repo}#7 "${pr.title}" anyway?`);
  });
});
