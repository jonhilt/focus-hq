// The QA scores plugin in the browser: nothing to show of its own yet. Its grades are lines in the ledger (Ledger
// review, under QA), each beside the verdict it grades.
import type { ClientPlugin } from '../../plugin-api/client';

const qaScores: ClientPlugin = {
  id: 'qa-scores',
  about: {
    name: 'QA scores',
    summary: 'A model grades some of QA’s reports against the diff each reviewed, thorough, shallow or wrong, so changes to QA can be judged by how its real work scores.',
    adds: [
      'A qa-score line in the ledger for each report graded, stamped with the QA prompt, model and effort behind it',
      'The rubric and scale in .focus/scorers/qa-report.md, changed by pull request',
    ],
    cost: 'background',
    costDetail: 'Grades the share of QA’s reports its scorer file samples (a quarter, to start) on Haiku, each with its diff: about 9 cents a report, so about $1 a day at 40 reviews, and about $4 for the week before it was switched on.',
  },
};

export default qaScores;
