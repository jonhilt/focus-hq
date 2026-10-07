import { describe, expect, it } from 'vitest';
import { artifactUrl, latestArtifact } from './artifacts';

describe('artifacts', () => {
  it('shows the one shown last, wherever it stands in the list', () => {
    const artifacts = [{ id: 'data-flow', title: 'Data flow', at: 3 }, { id: 'mockup', title: 'Mockup', at: 2 }];
    expect(latestArtifact(artifacts)?.id).toBe('data-flow');
    expect(latestArtifact([])).toBeUndefined();
    expect(latestArtifact(undefined)).toBeUndefined();
  });

  it('gives each version of an artifact a URL of its own', () => {
    expect(artifactUrl('lead_p_1', { id: 'mockup', title: 'Mockup', at: 7 }, 'jpg')).toBe('/api/artifacts/lead_p_1/mockup.jpg?v=7');
  });
});
