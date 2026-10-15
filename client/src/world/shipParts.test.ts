import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ShipHost, ShipPart } from '../plugins';
import { shipParts } from './shipParts';

function recordingHost() {
  const done: string[] = [];
  const spaces = new THREE.Group();
  const host: ShipHost = {
    seat: () => undefined,
    mount: (_deck, object) => done.push(`mount ${object.name}`),
    collide: (box) => done.push(`collide ${box.minX}`),
    interactive: (object) => done.push(`interactive ${object.name}`),
    hall: (projectId) => ({ mount: (object) => done.push(`hall ${projectId} ${object.name}`), toWorld: (local) => local.clone() }),
    space: () => {
      const root = new THREE.Group();
      spaces.add(root);
      return { root, toWorld: (local) => local.clone() };
    },
  };
  return { host, done, spaces };
}

describe('shipParts', () => {
  it('builds each plugin’s part, leaving out those with none', () => {
    const part: ShipPart = { dispose: () => undefined };
    const { host } = recordingHost();
    expect(shipParts([{ id: 'a', ship: () => part }, { id: 'b' }, { id: 'c', ship: () => null }], host)).toEqual([part]);
  });

  it('leaves out a part that throws, and builds the rest', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const part: ShipPart = { dispose: () => undefined };
    const broken = () => {
      throw new Error('no seat');
    };
    const { host } = recordingHost();
    expect(shipParts([{ id: 'broken', ship: broken }, { id: 'fine', ship: () => part }], host)).toEqual([part]);
    expect(error).toHaveBeenCalledWith('Plugin broken\'s part of the ship failed:', expect.any(Error));
    error.mockRestore();
  });

  it('drops what a part that throws asked for before it threw, and keeps what the others asked for', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, done } = recordingHost();
    const named = (name: string) => Object.assign(new THREE.Group(), { name });
    const box = (x: number) => ({ minX: x, maxX: x + 1, minZ: 0, maxZ: 1 });
    const broken = (h: ShipHost) => {
      h.collide(box(1));
      h.interactive(named('lost'), () => 'lost', () => undefined);
      h.mount('command', named('lost'));
      throw new Error('half built');
    };
    const fine = (h: ShipHost): ShipPart => {
      h.collide(box(2));
      h.interactive(named('kept'), () => 'kept', () => undefined);
      h.mount('command', named('kept'));
      return { dispose: () => undefined };
    };
    shipParts([{ id: 'broken', ship: broken }, { id: 'fine', ship: fine }], host);
    expect(done).toEqual(['collide 2', 'interactive kept', 'mount kept']);
    error.mockRestore();
  });

  it('drops what a part that throws stood in a hall, and the space it made', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, done, spaces } = recordingHost();
    const named = (name: string) => Object.assign(new THREE.Group(), { name });
    const broken = (h: ShipHost) => {
      h.hall('p')?.mount(named('lost'));
      h.space(() => 'a space');
      throw new Error('half built');
    };
    const fine = (h: ShipHost): ShipPart => {
      h.hall('p')?.mount(named('kept'));
      h.space(() => 'a space');
      return { dispose: () => undefined };
    };
    shipParts([{ id: 'broken', ship: broken }, { id: 'fine', ship: fine }], host);
    expect(done).toEqual(['hall p kept']);
    expect(spaces.children).toHaveLength(1);
    error.mockRestore();
  });

  it('does what a part asks once it stands there and then', () => {
    const { host, done } = recordingHost();
    let later: ShipHost | undefined;
    shipParts([{ id: 'views', ship: (h) => ((later = h), { dispose: () => undefined }) }], host);
    later?.interactive(Object.assign(new THREE.Group(), { name: 'view' }), () => 'view', () => undefined);
    expect(done).toEqual(['interactive view']);
  });
});
