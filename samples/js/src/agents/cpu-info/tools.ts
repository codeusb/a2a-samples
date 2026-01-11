import { ai, z } from "./genkit.js";
import os from "os";

export const getCPUInfo = ai.defineTool(
  {
    name: "getCPUInfo",
    description: "Get information about the CPUs on the host machine.",
    inputSchema: z.object({}),
    outputSchema: z.array(
      z.object({
        model: z.string(),
        speed: z.number(),
        times: z.object({
          user: z.number(),
          nice: z.number(),
          sys: z.number(),
          idle: z.number(),
          irq: z.number(),
        }),
      })
    ),
  },
  async () => {
    return os.cpus();
  }
);
