import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function slowTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "slow-tool",
    label: "Slow Tool",
    description: "Synthetic slow tool",
    parameters: { type: "object", properties: {}, required: [] } as never,
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { content: [{ type: "text" as const, text: "ok" }] };
    },
  });
}
