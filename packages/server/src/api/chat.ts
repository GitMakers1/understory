import express, { type Router } from "express";
import { convertToModelMessages, type UIMessage } from "ai";
import { streamChat, type ProjectManager, type SettingsStore } from "@understory/core";
import { requestKb } from "./browse.js";

interface ChatBody {
  messages: UIMessage[];
  model?: string;
}

/**
 * Streaming chat endpoint for the web UI (`useChat`). Full agent toolset —
 * the chat exists to exercise the same agent the MCP server uses.
 */
export function chatRouter(pm: ProjectManager, store?: SettingsStore): Router {
  const router = express.Router();

  router.post("/chat", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    const { messages, model } = req.body as ChatBody;
    const { result } = await streamChat(kb, convertToModelMessages(messages), {
      model,
      settings: store,
    });
    const response = result.toUIMessageStreamResponse();
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
      }
    }
    res.end();
  });

  return router;
}
