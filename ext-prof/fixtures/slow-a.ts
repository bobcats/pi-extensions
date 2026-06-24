import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function slowA(pi: ExtensionAPI) {
  pi.on("turn_start", async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}
