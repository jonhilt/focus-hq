// `pnpm run fence:lower`: lowers the ratchet's baseline to where each file's type assertions now are. It never raises one.
import { fenceCounts, readBaseline, writeBaseline } from './fenceFiles';
import { fenceDrift, lowered } from './fenceRatchet';

const baseline = readBaseline();
const counts = fenceCounts();
const next = lowered(baseline, counts);
const sum = (c: Record<string, number>) => Object.values(c).reduce((n, v) => n + v, 0);
writeBaseline(next);
console.log(`Type assertions baseline: ${sum(baseline)} → ${sum(next)}`);
const { over } = fenceDrift(next, counts);
if (over.length) console.log(`Still over their baseline (not raised): ${over.map((d) => `${d.file} ${d.count}/${d.baseline}`).join(', ')}`);
