import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function slowB(pi: ExtensionAPI) {
  pi.on("turn_start", async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}
