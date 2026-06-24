import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function slowCommand(pi: ExtensionAPI) {
  pi.registerCommand("slow-cmd", {
    description: "Synthetic slow command",
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    },
  });
}
