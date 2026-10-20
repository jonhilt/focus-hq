// The chief of staff in the browser (README.md): only its switch in a project's settings, for now. It shows nothing
// else: its verdicts are in the ledger's review, under Sessions.
import type { ClientPlugin } from '../../plugin-api/client';
import { CHIEF_OF_STAFF } from './shared';

const chiefOfStaff: ClientPlugin = {
  id: CHIEF_OF_STAFF,
  project: {
    label: 'Chief of staff (shadow)',
    about: 'Judges where each of a goal lead’s turns would go (carry on, a card for you, interrupt you, back to the lead) and keeps it in the ledger, without acting on it',
  },
};

export default chiefOfStaff;
