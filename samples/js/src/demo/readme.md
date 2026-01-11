# Walkthrough - Demo Agents
I have created two new demo agents: `cpu-info` and `echarts-data`.
## Agents Created
### 1. CPU Info Agent (`samples/js/src/agents/cpu-info`)
This agent can query the host machine's CPU information.
- **Tools**: `getCPUInfo` (uses `os.cpus()`)
- **Port**: 41242
- **Command**: `npm run agents:cpu-info`
### 2. Echarts Data Agent (`samples/js/src/agents/echarts-data`)
This agent generates Echarts-compatible JSON for charts based on natural language requests.
- **Port**: 41243
- **Command**: `npm run agents:echarts-data`
## How to Verify
You can verify these agents using the A2A CLI (`samples/python/hosts/cli`) or any other A2A client.
### Prerequisites
- Ensure `GEMINI_API_KEY` is set in your environment.
### Verifying CPU Info Agent
1. Start the agent:
   ```bash
   cd samples/js
   npm run agents:cpu-info
In another terminal, run the CLI (assuming you are in samples/python/hosts/cli):
uv run . --agent http://localhost:41242
Ask the agent: "What are the specs of this cpu?"
Verifying Echarts Agent
Start the agent:
cd samples/js
npm run agents:echarts-data
In another terminal, run the CLI:
uv run . --agent http://localhost:41243
Ask the agent: "Create a bar chart showing the population of the top 3 cities in China."
You should see a raw JSON object response.
