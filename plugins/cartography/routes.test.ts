import { describe, expect, it } from 'vitest';
import { apisImplemented, calledIn, crossCalls, declaredIn, repoRoutes, sameRoute, segments, specPaths } from './routes';

describe('segments and sameRoute', () => {
  it('reads a path\'s segments, parameters of every kind as *', () => {
    expect(segments('https://h:9966/petclinic/api/owners/{ownerId}/pets?x=1')).toEqual(['petclinic', 'api', 'owners', '*', 'pets']);
    expect(segments('/owners/:id/pets/${petId}')).toEqual(['owners', '*', 'pets', '*']);
  });

  it('matches a call to a route when one ends with the other, names to the same names', () => {
    expect(sameRoute('owners', '/owners')).toBe(true);
    expect(sameRoute('owners/*/pets', '/owners/{ownerId}/pets')).toBe(true);
    expect(sameRoute('/petclinic/api/owners', '/owners')).toBe(true);
    expect(sameRoute('vets', '/pets/{petId}')).toBe(false);
    expect(sameRoute('owners', '/owners/{ownerId}')).toBe(false);
    expect(sameRoute('*', '/owners/{ownerId}')).toBe(false);
  });
});

describe('declaredIn', () => {
  it('reads a Spring controller\'s mappings under its class\'s', () => {
    const java = `@RestController
@RequestMapping("/api/owners")
public class OwnerController {
  // @GetMapping("/commented")
  @GetMapping
  List<Owner> all() { return null; }
  @GetMapping("/{id}") Owner one() { return null; }
  @PostMapping(value = {"/a", "/b"}) void add() {}
  @RequestMapping(path = "/legacy", method = RequestMethod.PUT) void old() {}
}`;
    expect(declaredIn('Owner.java', java)).toEqual(['/api/owners', '/api/owners/{id}', '/api/owners/a', '/api/owners/b', '/api/owners/legacy']);
  });

  it('reads Express-style handlers, not a client\'s calls', () => {
    expect(declaredIn('s.ts', "app.get('/api/orders', h); router.post(\"/api/orders/:id\", h); api.get('/api/x');")).toEqual(['/api/orders', '/api/orders/:id']);
  });

  it('reads an OpenAPI spec\'s paths, YAML or JSON', () => {
    expect(specPaths('openapi: 3.0.1\npaths:\n  /owners:\n    get:\n      tags: [owner]\n  /owners/{ownerId}:\n    get: {}\ncomponents:\n  /not: {}\n')).toEqual(['/owners', '/owners/{ownerId}']);
    expect(specPaths('{"paths": {"/vets": {}}}')).toEqual(['/vets']);
    expect(apisImplemented('public class OwnerRestController implements OwnersApi, Serializable {')).toEqual(['OwnersApi']);
  });
});

describe('calledIn', () => {
  it('reads the path-like strings of a file that makes HTTP calls, however its URLs are glued', () => {
    const ts = "import { HttpClient } from '@angular/common/http';\nimport { x } from './x';\nconst u = environment.API + 'owners';\nthis.http.post(env.API + `owners/${ownerId}/pets`, pet);\nthis.http.get('assets/i.png');";
    expect(calledIn(ts)).toEqual(['owners', 'owners/*/pets']);
    expect(calledIn("const route = 'owners';")).toEqual([]);
  });
});

describe('crossCalls', () => {
  it('ties a part that calls routes to the part in another repo that declares them, the nearest route each', () => {
    const api = repoRoutes(
      'o/api',
      new Map([
        ['src/main/resources/openapi.yml', 'paths:\n  /owners:\n    get: {}\n  /v2/owners:\n    get: {}\n  /vets:\n    get: {}\n'],
        ['src/owner/OwnerController.java', 'class OwnerController implements OwnersApi {}'],
        ['src/vet/VetController.java', 'class VetController implements VetsApi {}'],
      ]),
      (f) => (f.includes('/owner/') ? 'owners' : f.includes('/vet/') ? 'vets' : undefined),
    );
    const web = repoRoutes('o/web', new Map([['app/owners/owner.service.ts', "this.http.get(API + 'owners'); this.http.get(API + 'vets');"]]), () => 'ui');
    expect(crossCalls([api, web])).toEqual([
      { from: { repo: 'o/web', part: 'ui' }, to: { repo: 'o/api', part: 'owners' }, routes: ['/owners'] },
      { from: { repo: 'o/web', part: 'ui' }, to: { repo: 'o/api', part: 'vets' }, routes: ['/vets'] },
    ]);
  });
});
