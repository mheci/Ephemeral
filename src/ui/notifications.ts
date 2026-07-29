import { element } from "./dom";

let timer: number | undefined;

export function notify(message: string, kind: "success" | "error" = "success"): void {
  const region = element<HTMLElement>("#notification");
  region.textContent = message;
  region.dataset["kind"] = kind;
  region.hidden = false;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    region.hidden = true;
  }, 4_000);
}
