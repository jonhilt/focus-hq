import type * as THREE from 'three';

// Changes a few pixels of a canvas texture already on the GPU without sending the whole canvas again: a busy
// terminal's blinking cursor on a briefing room's 2400 × 1000 viewscreen. Sending the whole of that canvas held a
// frame up for 70 ms on a laptop's integrated GPU, twice a second. The patch leaves the texture's smaller mipmaps as
// they were, which only the cursor's few pixels differ in.

let renderer: THREE.WebGLRenderer | null = null;

/** Lets textures be patched on `r`'s GPU from now on. */
export function patchTexturesOn(r: THREE.WebGLRenderer): void {
  renderer = r;
}

/**
 * Writes `patch` into `texture` with its top left at (`x`, `y`) on the texture's canvas. False if it couldn't (the
 * texture isn't on the GPU yet, or is waiting to be sent again), when the whole canvas has to go instead.
 */
export function patchTexture(texture: THREE.Texture, patch: HTMLCanvasElement, x: number, y: number): boolean {
  if (!renderer) return false;
  const props = renderer.properties.get(texture) as { __webglTexture?: WebGLTexture; __version?: number };
  if (!props.__webglTexture || props.__version !== texture.version) return false;
  const gl = renderer.getContext();
  const { state } = renderer;
  state.activeTexture(gl.TEXTURE0);
  state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
  state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
  state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha);
  state.pixelStorei(gl.UNPACK_ALIGNMENT, texture.unpackAlignment);
  // flipped as it's sent, so the canvas's top is the texture's last row
  const height = (texture.image as { height: number }).height;
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, texture.flipY ? height - y - patch.height : y, gl.RGBA, gl.UNSIGNED_BYTE, patch);
  state.unbindTexture();
  return true;
}
