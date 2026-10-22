// Plugins (docs/plugins.md): what Focus does beyond its core, each switched on by FOCUS_PLUGINS. What the browser
// learns of them: which are on, each one's state, and the label on work a plugin hands an agent.

/** Work a plugin hands an agent in place of an issue (task `brief`): whose it is, and how Focus labels it. */
export interface Brief {
  /** The plugin's id. */
  plugin: string;
  /** Which of the plugin's kinds of brief. */
  kind: string;
  /** A word for the agent's name tag and panels, like `Climb`. */
  label: string;
  icon: string;
}

/**
 * A secret a plugin needs (an API key, say), set in the Plugins tab or by its environment variable: kept in
 * secrets.env like Focus's own, never sent to a browser (docs/settings.md).
 */
export interface PluginSecret {
  /** Its environment variable's name, also its name in secrets.env: ending in _KEY, _TOKEN or _SECRET. */
  name: string;
  /** What it is, for the Plugins tab: "OpenAI API key". */
  label: string;
  /** What it's for, or where to get one. */
  hint?: string;
}

/** A plugin's secret as the browser hears of it: where it's set (an environment variable, the Plugins tab, or nowhere), never its value. */
export interface PluginSecretStatus extends PluginSecret {
  by: 'env' | 'captain' | null;
}

/** Each plugin's state (its slot in Focus's saved state), by plugin id: only the plugins switched on. */
export type PluginStates = Record<string, unknown>;
