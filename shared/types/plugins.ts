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

/** Each plugin's state (its slot in Focus's saved state), by plugin id: only the plugins switched on. */
export type PluginStates = Record<string, unknown>;
