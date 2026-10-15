import type { ClientPlugin, ShipHost, ShipPart } from '../plugins';

/**
 * The plugins' parts of the ship (`ClientPlugin.ship`), each built with `host`: one that throws is logged and left out,
 * with what it mounted, walled off or made usable before it threw, so one plugin's bug never stops the ship being
 * built nor leaves half of its part behind. What a plugin asks of `host` is held until its `ship` returns.
 */
export function shipParts(plugins: Pick<ClientPlugin, 'id' | 'ship'>[], host: ShipHost): ShipPart[] {
  return plugins.flatMap((plugin) => {
    const held: (() => void)[] = [];
    const lent: ShipHost = {
      seat: (deck, name) => host.seat(deck, name),
      mount: (deck, object) => held.push(() => host.mount(deck, object)),
      collide: (box) => held.push(() => host.collide(box)),
      interactive: (object, label, use) => held.push(() => host.interactive(object, label, use)),
    };
    try {
      const part = plugin.ship?.(lent) ?? null;
      for (const commit of held) commit();
      return part ? [part] : [];
    } catch (err) {
      console.error(`Plugin ${plugin.id}'s part of the ship failed:`, err);
      return [];
    }
  });
}
