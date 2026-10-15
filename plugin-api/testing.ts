// The plugin API's test kit (docs/plugins.md): for a plugin's *.test.ts only. `office()` is a pretend office a test can
// switch the plugin on in; `OFFICE_DIR` is the office's own checkout, a real repo to try things on.
import { config } from '../server/config';

export { office, until } from '../server/agents/fakeOffice';
export const OFFICE_DIR = config.root;
