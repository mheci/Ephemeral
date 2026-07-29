export function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element: ${selector}`);
  return value;
}

export function clear(element: HTMLElement): void {
  element.replaceChildren();
}

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    title?: string;
    attrs?: Record<string, string>;
  } = {},
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (options.className) result.className = options.className;
  if (options.text !== undefined) result.textContent = options.text;
  if (options.title) result.title = options.title;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    result.setAttribute(name, value);
  }
  return result;
}
