/** Blender's Windows install folders (`Blender 5.2`, `Blender 4.5`, `Blender`), newest version first. */
export function newestFirst(folders: string[]): string[] {
  const version = (f: string) => (f.match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  return folders
    .filter((f) => /^Blender/i.test(f))
    .sort((a, b) => {
      const [va, vb] = [version(a), version(b)];
      for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
      return 0;
    });
}
