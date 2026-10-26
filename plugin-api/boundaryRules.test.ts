import { describe, expect, it } from 'vitest';
import { pluginOf, refusal } from './boundaryRules';

describe('the line between the core and its plugins', () => {
  it('knows a plugin’s files by their folder under plugins/, and the core’s as no plugin’s', () => {
    expect(pluginOf('plugins/maps/server.ts')).toBe('maps');
    expect(pluginOf('plugins/maps/scripts/run.ts')).toBe('maps');
    expect(pluginOf('server/routes.ts')).toBeUndefined();
    expect(pluginOf('plugin-api/server.ts')).toBeUndefined();
  });

  it('lets a plugin import its own files, plugin-api/ and another plugin’s api.ts, and nothing else of Focus', () => {
    expect(refusal('plugins/maps/server.ts', 'plugins/maps/shared.ts')).toBeUndefined();
    expect(refusal('plugins/maps/server.ts', 'plugin-api/server.ts')).toBeUndefined();
    expect(refusal('plugins/maps/server.ts', 'plugins/scores/api.ts')).toBeUndefined();
    expect(refusal('plugins/maps/server.ts', 'plugins/scores/types.ts')).toBe('maps reaches into scores past its api.ts');
    expect(refusal('plugins/maps/server.ts', 'server/config.ts')).toBe('maps reaches into the core past plugin-api/');
    expect(refusal('plugins/maps/client.ts', 'client/src/ui/dom.ts')).toBe('maps reaches into the core past plugin-api/');
    expect(refusal('plugins/maps/scripts/run.ts', 'shared/types/index.ts')).toBe('maps reaches into the core past plugin-api/');
    expect(refusal('plugins/maps/scripts/run.ts', 'plugins/scores/scores.ts')).toBe('maps reaches into scores past its api.ts');
  });

  it('keeps the test kit to tests, and the core out of every plugin', () => {
    expect(refusal('plugins/maps/map.test.ts', 'plugin-api/testing.ts')).toBeUndefined();
    expect(refusal('plugins/maps/map.ts', 'plugin-api/testing.ts')).toBe('the test kit is for tests only');
    expect(refusal('server/routes.ts', 'plugins/maps/server.ts')).toBe('the core reaches into a plugin');
    expect(refusal('plugin-api/server.ts', 'plugins/maps/shared.ts')).toBe('the core reaches into a plugin');
    expect(refusal('server/routes.ts', 'server/config.ts')).toBeUndefined();
  });
});
