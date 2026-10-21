// The chief of staff in the browser (README.md): its switch in a project's settings. What it judged shows in Comms, on
// the lead's turn (shared/tricorder.ts's `laneOf`).
import type { ClientPlugin } from '../../plugin-api/client';
import { CHIEF_OF_STAFF } from './shared';

const chiefOfStaff: ClientPlugin = {
  id: CHIEF_OF_STAFF,
  project: {
    label: 'Chief of staff',
    about: 'Judges each of a goal lead’s turns as it ends: a card for you, an interrupt, or words for the lead (carry on, or back to them) ready for you to send from Comms. It sends nothing itself',
  },
};

export default chiefOfStaff;
