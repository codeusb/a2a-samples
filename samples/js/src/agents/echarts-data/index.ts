import express from "express";
import { v4 as uuidv4 } from 'uuid';

import {
    AgentCard,
    Task,
    TaskState,
    TaskStatusUpdateEvent,
    TextPart,
    Message
} from "@a2a-js/sdk";
import {
    InMemoryTaskStore,
    TaskStore,
    AgentExecutor,
    RequestContext,
    ExecutionEventBus,
    DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";
import { MessageData } from "genkit";
import { ai } from "./genkit.js";

if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY environment variable is required")
    process.exit(1);
}

// Simple store for contexts
const contexts: Map<string, Message[]> = new Map();

// Load the Genkit prompt
const echartsAgentPrompt = ai.prompt('agent');

/**
 * EchartsAgentExecutor implements the agent's core logic.
 */
class EchartsAgentExecutor implements AgentExecutor {
    private cancelledTasks = new Set<string>();

    public cancelTask = async (
        taskId: string,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        this.cancelledTasks.add(taskId);
    };

    async execute(
        requestContext: RequestContext,
        eventBus: ExecutionEventBus
    ): Promise<void> {
        const userMessage = requestContext.userMessage;
        const existingTask = requestContext.task;

        const taskId = existingTask?.id || uuidv4();
        const contextId = userMessage.contextId || existingTask?.contextId || uuidv4();

        console.log(
            `[EchartsAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
        );

        if (!existingTask) {
            const initialTask: Task = {
                kind: 'task',
                id: taskId,
                contextId: contextId,
                status: {
                    state: "submitted",
                    timestamp: new Date().toISOString(),
                },
                history: [userMessage],
                metadata: userMessage.metadata,
            };
            eventBus.publish(initialTask);
        }

        const workingStatusUpdate: TaskStatusUpdateEvent = {
            kind: 'status-update',
            taskId: taskId,
            contextId: contextId,
            status: {
                state: "working",
                message: {
                    kind: 'message',
                    role: 'agent',
                    messageId: uuidv4(),
                    parts: [{ kind: 'text', text: 'Generating chart data...' }],
                    taskId: taskId,
                    contextId: contextId,
                },
                timestamp: new Date().toISOString(),
            },
            final: false,
        };
        eventBus.publish(workingStatusUpdate);

        const historyForGenkit = contexts.get(contextId) || [];
        if (!historyForGenkit.find(m => m.messageId === userMessage.messageId)) {
            historyForGenkit.push(userMessage);
        }
        contexts.set(contextId, historyForGenkit)

        const messages: MessageData[] = historyForGenkit
            .map((m) => ({
                role: (m.role === 'agent' ? 'model' : 'user') as 'user' | 'model',
                content: m.parts
                    .filter((p): p is TextPart => p.kind === 'text' && !!(p as TextPart).text)
                    .map((p) => ({
                        text: (p as TextPart).text,
                    })),
            }))
            .filter((m) => m.content.length > 0);

        if (messages.length === 0) {
            const failureUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: "failed",
                    message: {
                        kind: 'message',
                        role: 'agent',
                        messageId: uuidv4(),
                        parts: [{ kind: 'text', text: 'No message found to process.' }],
                        taskId: taskId,
                        contextId: contextId,
                    },
                    timestamp: new Date().toISOString(),
                },
                final: true,
            };
            eventBus.publish(failureUpdate);
            return;
        }

        const goal = existingTask?.metadata?.goal as string | undefined || userMessage.metadata?.goal as string | undefined;

        try {
            const response = await echartsAgentPrompt(
                { goal: goal, now: new Date().toISOString() },
                {
                    messages,
                }
            );

            if (this.cancelledTasks.has(taskId)) {
                const cancelledUpdate: TaskStatusUpdateEvent = {
                    kind: 'status-update',
                    taskId: taskId,
                    contextId: contextId,
                    status: {
                        state: "canceled",
                        timestamp: new Date().toISOString(),
                    },
                    final: true,
                };
                eventBus.publish(cancelledUpdate);
                return;
            }

            let responseText = response.text;
            console.info(`[EchartsAgentExecutor] Prompt response: ${responseText}`);

            // Attempt to clean JSON if wrapped in markdown blocks
            if (responseText.startsWith("```")) {
                responseText = responseText.replace(/^```(json)?/, '').replace(/```$/, '').trim();
            }

            let finalA2AState: TaskState = "completed";

            const agentMessage: Message = {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [{ kind: 'text', text: responseText }],
                taskId: taskId,
                contextId: contextId,
            };
            historyForGenkit.push(agentMessage);
            contexts.set(contextId, historyForGenkit)

            const finalUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: finalA2AState,
                    message: agentMessage,
                    timestamp: new Date().toISOString(),
                },
                final: true,
            };
            eventBus.publish(finalUpdate);

        } catch (error: any) {
            console.error(
                `[EchartsAgentExecutor] Error processing task ${taskId}:`,
                error
            );
            const errorUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: "failed",
                    message: {
                        kind: 'message',
                        role: 'agent',
                        messageId: uuidv4(),
                        parts: [{ kind: 'text', text: `Agent error: ${error.message}` }],
                        taskId: taskId,
                        contextId: contextId,
                    },
                    timestamp: new Date().toISOString(),
                },
                final: true,
            };
            eventBus.publish(errorUpdate);
        }
    }
}

// --- Server Setup ---

const echartsAgentCard: AgentCard = {
    name: 'Echarts Data Agent',
    description: 'An agent that generates Echarts JSON data.',
    url: 'http://localhost:41243/',
    provider: {
        organization: 'A2A Samples',
        url: 'https://example.com/a2a-samples'
    },
    protocolVersion: 'v1',
    version: '0.0.1',
    capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [
        {
            id: 'generate_chart',
            name: 'Generate Chart',
            description: 'Generate Echarts option JSON from natural language.',
            tags: ['chart', 'visualization', 'echarts'],
            examples: [
                'Create a bar chart for Apple sales in 2023.',
                'Show me a breakdown of users by country.',
            ],
            inputModes: ['text'],
            outputModes: ['text', 'task-status']
        },
    ],
    supportsAuthenticatedExtendedCard: false,
};

async function main() {
    const taskStore: TaskStore = new InMemoryTaskStore();
    const agentExecutor: AgentExecutor = new EchartsAgentExecutor();

    const requestHandler = new DefaultRequestHandler(
        echartsAgentCard,
        taskStore,
        agentExecutor
    );

    const appBuilder = new A2AExpressApp(requestHandler);
    const expressApp = appBuilder.setupRoutes(express());

    const PORT = process.env.PORT || 41243;
    expressApp.listen(PORT, () => {
        console.log(`[EchartsAgent] Server started on http://localhost:${PORT}`);
        console.log(`[EchartsAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
    });
}

main().catch(console.error);
