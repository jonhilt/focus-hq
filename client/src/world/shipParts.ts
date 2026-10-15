import type { ClientPlugin, PluginSpace, ShipHost, ShipPart } from '../plugins';

/**
 * The plugins' parts of the ship (`ClientPlugin.ship`), each built with `host`: one that throws is logged and left out,
 * with what it mounted, walled off or made usable before it threw, and any space it made, so one plugin's bug never
 * stops the ship being built nor leaves half of its part behind. What a plugin asks of `host` is held until its `ship`
 * returns; what its part asks later (making a view it puts up usable, say) is done there and then.
 */
export function shipParts(plugins: Pick<ClientPlugin, 'id' | 'ship'>[], host: ShipHost): ShipPart[] {
  return plugins.flatMap((plugin) => {
    const held: (() => void)[] = [];
    const spaces: PluginSpace[] = [];
    let building = true;
    const hold = (commit: () => void) => (building ? held.push(commit) : commit());
    const lent: ShipHost = {
      seat: (deck, name) => host.seat(deck, name),
      mount: (deck, object) => hold(() => host.mount(deck, object)),
      collide: (box) => hold(() => host.collide(box)),
      interactive: (object, label, use, reach) => hold(() => host.interactive(object, label, use, reach)),
      hall: (projectId) => {
        const hall = host.hall(projectId);
        return hall && { mount: (object) => hold(() => hall.mount(object)), toWorld: (local) => hall.toWorld(local) };
      },
      space: (label) => {
        const space = host.space(label);
        spaces.push(space);
        return space;
      },
    };
    try {
      const part = plugin.ship?.(lent) ?? null;
      building = false;
      for (const commit of held) commit();
      if (!part) for (const space of spaces) space.root.removeFromParent();
      return part ? [part] : [];
    } catch (err) {
      console.error(`Plugin ${plugin.id}'s part of the ship failed:`, err);
      for (const space of spaces) space.root.removeFromParent();
      return [];
    }
  });
}
