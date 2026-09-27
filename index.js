const PARTS = {
  activities: "snippet,contentDetails",
  channels: "snippet,contentDetails,statistics,status",
  channelSections: "snippet,contentDetails",
  commentThreads: "snippet,replies",
  comments: "snippet",
  guideCategories: "snippet",
  i18nLanguages: "snippet",
  i18nRegions: "snippet",
  playlistItems: "snippet,contentDetails,status",
  playlists: "snippet,contentDetails,status",
  search: "snippet",
  subscriptions: "snippet,contentDetails",
  videoCategories: "snippet",
  videos: "snippet,contentDetails,statistics,status"
};

const TOOL = {
  name: "youtube_read",
  description:
    "Read public data from YouTube Data API v3. Use resource plus query parameters.",
  inputSchema: {
    type: "object",
    properties: {
      resource: { type: "string", enum: Object.keys(PARTS) },
      params: {
        type: "object",
        description:
          "YouTube API query parameters such as q, id, channelId, playlistId, videoId, maxResults, pageToken, order, type, regionCode and part."
      }
    },
    required: ["resource"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  }
};

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*"
};

function reply(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers
  });
}

function rpcError(id, code, message) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message }
    }),
    { headers }
  );
}

async function youtube(env, resource, params = {}) {
  if (!env.YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is not configured yet.");
  }

  if (!PARTS[resource]) {
    throw new Error("Unsupported YouTube resource.");
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  const merged = { part: PARTS[resource], ...params };

  if (resource === "search" && !merged.maxResults) {
    merged.maxResults = 10;
  }

  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("key", env.YOUTUBE_API_KEY);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `YouTube API error ${response.status}`
    );
  }

  return data;
}

async function handleMcp(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET") {
    return new Response("YouTube MCP is online.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  let msg;
  try {
    msg = await request.json();
  } catch {
    return rpcError(null, -32700, "Invalid JSON");
  }

  if (msg.method?.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  if (msg.method === "initialize") {
    return reply(msg.id, {
      protocolVersion: msg.params?.protocolVersion || "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: {
        name: "youtube-chatgpt-mcp",
        version: "1.0.0"
      },
      instructions: "Read-only access to public YouTube Data API information."
    });
  }

  if (msg.method === "ping") {
    return reply(msg.id, {});
  }

  if (msg.method === "tools/list") {
    return reply(msg.id, { tools: [TOOL] });
  }

  if (msg.method === "tools/call") {
    if (msg.params?.name !== "youtube_read") {
      return rpcError(msg.id, -32602, "Unknown tool");
    }

    try {
      const args = msg.params.arguments || {};
      const data = await youtube(env, args.resource, args.params || {});

      return reply(msg.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      });
    } catch (e) {
      return reply(msg.id, {
        isError: true,
        content: [
          {
            type: "text",
            text: e instanceof Error ? e.message : String(e)
          }
        ]
      });
    }
  }

  return rpcError(msg.id, -32601, "Method not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("YouTube ChatGPT MCP Worker is online.", {
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }

    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }

    return new Response("Not found", { status: 404 });
  }
};
