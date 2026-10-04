type Child = Node | string | number | null | undefined | false;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'children'>> & {
  class?: string;
  style?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  attrs?: Record<string, string>;
};

/** Tiny hyperscript helper: h('button', { class: 'btn', onclick }, 'Go'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props<K> | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    const { class: cls, style, on, attrs, ...rest } = props;
    if (cls) el.className = cls;
    if (style) el.setAttribute('style', style);
    if (on) for (const [name, fn] of Object.entries(on)) el.addEventListener(name, fn as EventListener);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    Object.assign(el, rest);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** replaceChildren that skips null/false children. */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren(...children.filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : String(c))));
}

/** Runs an async action from a button, disabling it meanwhile and reporting errors as toasts. */
export async function busy(button: HTMLButtonElement | null, fn: () => Promise<unknown>, onError: (msg: string) => void): Promise<void> {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = '…';
  }
  try {
    await fn();
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label ?? '';
    }
  }
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hrs = Math.round(m / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}
