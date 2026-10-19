// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PullRequest, QaReview } from '../../../shared/types';
import { api } from '../net/api';
import { confirmDialog } from '../ui/confirmDialog';
import { h } from '../ui/dom';
import { Actions, morph } from './actions';
import { mergeButton } from './home';

vi.mock('../net/api', () => ({ api: { mergePr: vi.fn(() => Promise.resolve()), mergeWhenPassed: vi.fn(() => Promise.resolve()) } }));
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(() => Promise.resolve(true)) }));

/** Lets a click that waited on the dialog carry on. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

const HEAD = 'abc1234def5678';
const pr = { repo: 'demo/webshop-api', number: 7, title: 'Wishlist endpoints', headSha: HEAD, mergeable: 'MERGEABLE', isDraft: false } as PullRequest;
const review = (r: Partial<QaReview>): QaReview => ({ projectId: 'p', repo: pr.repo, number: pr.number, title: pr.title, status: 'testing', sha: HEAD, requestedAt: 0, ...r });

/** The card as the Tricorder keeps it: rendered once, then morphed to each new render, the way main.ts updates the page. */
function card(first: QaReview | undefined, onCard: PullRequest = pr) {
  const actions = new Actions(() => undefined);
  const render = (r: QaReview | undefined) => h('div', null, mergeButton(actions, 'pr:p:demo/webshop-api#7', 'p', onCard, r));
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

  it('asks for the merge once QA passes when QA starts on a PR already on the page', () => {
    const c = card(undefined);
    c.become(review({ status: 'testing' }));
    expect(c.click()).toBe('⤵ Merge when QA passes');
    expect(api.mergeWhenPassed).toHaveBeenCalledWith('p', pr.repo, pr.number, true);
    expect(api.mergePr).not.toHaveBeenCalled();
  });

  it('merges straight away once QA has passed it', async () => {
    const c = card(review({ status: 'queued', sha: undefined }));
    c.become(review({ status: 'passed' }));
    expect(c.click()).toBe('⤵ squash & merge');
    await settle();
    expect(api.mergePr).toHaveBeenCalledWith('p', pr.repo, pr.number, false);
    expect(api.mergeWhenPassed).not.toHaveBeenCalled();
    expect(confirmDialog).toHaveBeenCalledWith({ message: `Merge ${pr.repo}#7 "${pr.title}"?` });
  });

  it('takes the request back while it’s waiting, and asks first when QA failed it', async () => {
    const c = card(review({ status: 'testing' }));
    c.become(review({ status: 'testing', mergeRequested: { at: 1 } }));
    c.click();
    expect(api.mergeWhenPassed).toHaveBeenCalledWith('p', pr.repo, pr.number, false);

    const passed = card(review({ status: 'passed' }));
    passed.become(review({ status: 'failed' }));
    passed.click();
    await settle();
    expect(confirmDialog).toHaveBeenLastCalledWith({ message: `QA failed it.\n\nMerge ${pr.repo}#7 "${pr.title}" anyway?` });
    expect(api.mergePr).toHaveBeenCalledWith('p', pr.repo, pr.number, false);
  });

  it('merges past a refused merge check only on purpose, asking first', async () => {
    const refused = card(review({ status: 'passed' }), { ...pr, mergeCheck: { state: 'refused', head: HEAD, reason: 'it conflicts with its base at 1234567' } });
    expect(refused.click()).toBe('⤵ Merge anyway');
    await settle();
    expect(confirmDialog).toHaveBeenLastCalledWith({ message: expect.stringContaining('Its merge check refused it: it conflicts with its base at 1234567') });
    expect(api.mergePr).toHaveBeenCalledWith('p', pr.repo, pr.number, true);
  });

  it('can’t be pressed while the merge check runs', () => {
    const checking = card(review({ status: 'passed' }), { ...pr, mergeCheck: { state: 'checking', head: HEAD } });
    expect(checking.click()).toBe('🚦 Checking the merge…');
    expect(api.mergePr).not.toHaveBeenCalled();
  });

  it('can’t be pressed while queued behind another merge, and says which', () => {
    const queued = card(review({ status: 'passed' }), { ...pr, mergeCheck: { state: 'queued', head: HEAD, behind: 41 } });
    expect(queued.click()).toBe('⏳ Queued behind #41');
    expect(api.mergePr).not.toHaveBeenCalled();
  });
});
