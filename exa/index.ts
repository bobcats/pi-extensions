import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import Exa from "exa-js";

type ExaResult = Record<string, unknown>;

type ExaResponse = {
  requestId?: string;
  costDollars?: { total?: number };
  results?: ExaResult[];
  output?: Record<string, unknown>;
};

type ExaAnswerResponse = {
  requestId?: string;
  costDollars?: { total?: number };
  answer?: unknown;
  citations?: ExaResult[];
};

type ExaAnswerChunk = {
  content?: string;
  citations?: ExaResult[];
};

type ExaResearch = {
  researchId?: string;
  status?: string;
  instructions?: string;
  output?: unknown;
  events?: unknown;
};

type ExaResearchList = {
  data?: ExaResearch[];
  hasMore?: boolean;
  nextCursor?: string;
};

type ExaClient = {
  search?: (query: string, options: Record<string, unknown>) => Promise<ExaResponse>;
  findSimilar?: (url: string, options: Record<string, unknown>) => Promise<ExaResponse>;
  getContents: (urls: string[] | string, options: Record<string, unknown>) => Promise<ExaResponse>;
  answer?: (query: string, options?: Record<string, unknown>) => Promise<ExaAnswerResponse>;
  streamAnswer?: (query: string, options?: Record<string, unknown>) => AsyncGenerator<ExaAnswerChunk>;
  research?: {
    create: (params: Record<string, unknown>) => Promise<ExaResearch>;
    get: (researchId: string, options?: Record<string, unknown>) => Promise<ExaResearch>;
    pollUntilFinished: (researchId: string, options?: Record<string, unknown>) => Promise<ExaResearch>;
    list: (options?: Record<string, unknown>) => Promise<ExaResearchList>;
  };
};

const DEFAULT_HIGHLIGHT_CHARACTERS = 4000;
const DEFAULT_TEXT_CHARACTERS = 12000;
const DEFAULT_CONTENT_CHARACTERS = 12000;
const DEFAULT_LIVECRAWL_TIMEOUT = 10000;
const MAX_OUTPUT_CHARACTERS = 20000;

const SEARCH_TYPES = ["auto", "fast", "instant", "deep", "deep-reasoning"] as const;
const SEARCH_CATEGORIES = ["company", "research paper", "news", "pdf", "personal site", "financial report", "people"] as const;
const ANSWER_MODELS = ["exa", "exa-pro"] as const;
const RESEARCH_MODELS = ["exa-research-fast", "exa-research", "exa-research-pro"] as const;
const CORE_TOOL_NAMES = ["exa_search", "exa_get_contents", "exa_answer"] as const;
const ADVANCED_TOOL_NAMES = [
  "exa_find_similar",
  "exa_research_create",
  "exa_research_get",
  "exa_research_poll",
  "exa_research_list",
] as const;

function requireApiKey(): string {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY is not set. Add it to your environment before using the Exa tools.");
  }
  return apiKey;
}

function truncate(text: string, max = MAX_OUTPUT_CHARACTERS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[Truncated at ${max} characters.]`;
}

function formatCost(total?: number): string | null {
  if (typeof total !== "number") return null;
  return `$${total.toFixed(4)}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function buildContents(params: {
  highlights?: boolean;
  text?: boolean;
  summary?: boolean;
  livecrawl?: boolean;
  maxCharacters?: number;
}): Record<string, unknown> {
  return compactObject({
    highlights: params.highlights === false ? false : { maxCharacters: DEFAULT_HIGHLIGHT_CHARACTERS },
    text: params.text ? { maxCharacters: params.maxCharacters ?? DEFAULT_TEXT_CHARACTERS } : false,
    summary: params.summary ? true : undefined,
    livecrawlTimeout: params.livecrawl ? DEFAULT_LIVECRAWL_TIMEOUT : undefined,
    maxAgeHours: params.livecrawl ? 0 : undefined,
  });
}

function buildSearchOptions(params: {
  type?: string;
  numResults?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  startCrawlDate?: string;
  endCrawlDate?: string;
  userLocation?: string;
  moderation?: boolean;
  useAutoprompt?: boolean;
  contents: Record<string, unknown>;
}): Record<string, unknown> {
  return compactObject({
    type: params.type,
    numResults: params.numResults,
    category: params.category,
    includeDomains: params.includeDomains,
    excludeDomains: params.excludeDomains,
    includeText: params.includeText,
    excludeText: params.excludeText,
    startPublishedDate: params.startPublishedDate,
    endPublishedDate: params.endPublishedDate,
    startCrawlDate: params.startCrawlDate,
    endCrawlDate: params.endCrawlDate,
    userLocation: params.userLocation,
    moderation: params.moderation,
    useAutoprompt: params.useAutoprompt,
    contents: params.contents,
  });
}

function formatResults(results: ExaResult[] | undefined): string {
  if (!results?.length) return "No results.";

  return truncate(results.map((result, index) => {
    const title = String(result.title ?? result.url ?? "Untitled result");
    const lines = [`${index + 1}. ${title}`];

    if (result.url) lines.push(`   ${String(result.url)}`);
    if (result.publishedDate) lines.push(`   published ${String(result.publishedDate)}`);
    if (result.author) lines.push(`   by ${String(result.author)}`);

    const highlights = Array.isArray(result.highlights) ? result.highlights : [];
    for (const highlight of highlights.slice(0, 3)) {
      lines.push(`   ↳ ${String(highlight)}`);
    }

    if (typeof result.summary === "string" && result.summary.trim()) {
      lines.push(`   summary: ${result.summary}`);
    }

    if (typeof result.text === "string" && result.text.trim()) {
      lines.push(`   ${result.text}`);
    }

    return lines.join("\n");
  }).join("\n\n"));
}

function formatSearchResponse(label: string, response: ExaResponse): string {
  const results = response.results ?? [];
  const cost = formatCost(response.costDollars?.total);

  return [
    [label, `${results.length} result(s)`, cost].filter(Boolean).join(" · "),
    response.requestId ? `request ${response.requestId}` : null,
    response.output ? `output\n${truncate(safeJson(response.output))}` : null,
    formatResults(results),
  ].filter(Boolean).join("\n\n");
}

function formatCitations(citations: ExaResult[] | undefined): string {
  if (!citations?.length) return "No citations.";
  return citations.map((citation, index) => `${index + 1}. ${String(citation.title ?? citation.url ?? "Untitled citation")}\n   ${String(citation.url ?? citation.id ?? "")}`).join("\n\n");
}

function formatResearch(research: ExaResearch): string {
  return truncate([
    research.researchId ? `Research ID: ${research.researchId}` : null,
    research.status ? `Status: ${research.status}` : null,
    research.instructions ? `Instructions: ${research.instructions}` : null,
    research.output !== undefined ? `Output:\n${safeJson(research.output)}` : null,
    research.events !== undefined ? `Events:\n${safeJson(research.events)}` : null,
  ].filter(Boolean).join("\n\n") || "No research data.");
}

function stringArray(description: string) {
  return Type.Array(Type.String(), { description });
}

function searchParameters(queryDescription: string, includeUrl = false) {
  return Type.Object(compactObject({
    ...(includeUrl ? { url: Type.String({ description: queryDescription }) } : { query: Type.String({ description: queryDescription }) }),
    type: Type.Optional(StringEnum(SEARCH_TYPES, { description: "Search mode." })),
    numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, description: "Number of results to return." })),
    category: Type.Optional(StringEnum(SEARCH_CATEGORIES, { description: "Optional content category filter." })),
    includeDomains: Type.Optional(stringArray("Only include these domains.")),
    excludeDomains: Type.Optional(stringArray("Exclude these domains.")),
    includeText: Type.Optional(stringArray("Required strings in page text.")),
    excludeText: Type.Optional(stringArray("Forbidden strings in page text.")),
    startPublishedDate: Type.Optional(Type.String({ description: "ISO date lower bound for published date." })),
    endPublishedDate: Type.Optional(Type.String({ description: "ISO date upper bound for published date." })),
    startCrawlDate: Type.Optional(Type.String({ description: "ISO date lower bound for crawl date." })),
    endCrawlDate: Type.Optional(Type.String({ description: "ISO date upper bound for crawl date." })),
    userLocation: Type.Optional(Type.String({ description: "Two-letter ISO country code." })),
    moderation: Type.Optional(Type.Boolean({ description: "Filter unsafe content." })),
    useAutoprompt: Type.Optional(Type.Boolean({ description: "Let Exa autoprompt expand the query." })),
    highlights: Type.Optional(Type.Boolean({ description: "Include Exa highlights. Default true." })),
    text: Type.Optional(Type.Boolean({ description: "Include page text." })),
    summary: Type.Optional(Type.Boolean({ description: "Include Exa summaries." })),
    livecrawl: Type.Optional(Type.Boolean({ description: "Force fresh crawling with maxAgeHours=0." })),
    maxCharacters: Type.Optional(Type.Integer({ minimum: 500, maximum: 20000, description: "Character cap for text mode." })),
    ...(includeUrl ? { excludeSourceDomain: Type.Optional(Type.Boolean({ description: "Exclude results from the source domain." })) } : {}),
  }));
}

export function createExaExtension(createClient = (apiKey: string): ExaClient => new Exa(apiKey) as unknown as ExaClient) {
  return function exaExtension(pi: ExtensionAPI) {
    const getClient = () => createClient(requireApiKey());

    pi.registerTool({
      name: "exa_search",
      label: "Exa Search",
      description: "Explore the web with Exa when you do not yet know the right URL. Best for exploratory search, current info, broad discovery, and short ranked excerpts.",
      promptSnippet: "Search the web with Exa for high-quality results and excerpts.",
      promptGuidelines: [
        "Use exa_search when the right source is not known yet or when the user needs current web information.",
        "Write Exa queries as natural language, not keyword fragments.",
        "Start with highlights-only output; request text only when the excerpt is insufficient.",
      ],
      parameters: searchParameters("Natural-language search query."),

      async execute(_toolCallId, params) {
        const client = getClient();
        if (!client.search) throw new Error("Installed exa-js client does not support search().");

        const response = await client.search(params.query, buildSearchOptions({
          type: params.type,
          numResults: params.numResults,
          category: params.category,
          includeDomains: params.includeDomains,
          excludeDomains: params.excludeDomains,
          includeText: params.includeText,
          excludeText: params.excludeText,
          startPublishedDate: params.startPublishedDate,
          endPublishedDate: params.endPublishedDate,
          startCrawlDate: params.startCrawlDate,
          endCrawlDate: params.endCrawlDate,
          userLocation: params.userLocation,
          moderation: params.moderation,
          useAutoprompt: params.useAutoprompt,
          contents: buildContents(params),
        }));

        return {
          content: [{ type: "text", text: formatSearchResponse("Exa search", response) }],
          details: {
            requestId: response.requestId,
            costDollars: response.costDollars,
            resultCount: response.results?.length ?? 0,
            results: response.results ?? [],
          },
        };
      },
    });

    pi.registerTool({
      name: "exa_find_similar",
      label: "Exa Find Similar",
      description: "Find pages similar to a known URL using Exa.",
      promptSnippet: "Find pages similar to a known URL with Exa.",
      promptGuidelines: [
        "Use exa_find_similar when you already have one strong source and want related pages.",
      ],
      parameters: searchParameters("URL to find similar pages for.", true),

      async execute(_toolCallId, params) {
        const client = getClient();
        if (!client.findSimilar) throw new Error("Installed exa-js client does not support findSimilar().");

        const response = await client.findSimilar(params.url, compactObject({
          numResults: params.numResults,
          excludeSourceDomain: params.excludeSourceDomain,
          category: params.category,
          includeDomains: params.includeDomains,
          excludeDomains: params.excludeDomains,
          includeText: params.includeText,
          excludeText: params.excludeText,
          startPublishedDate: params.startPublishedDate,
          endPublishedDate: params.endPublishedDate,
          startCrawlDate: params.startCrawlDate,
          endCrawlDate: params.endCrawlDate,
          contents: buildContents(params),
        }));

        return {
          content: [{ type: "text", text: formatSearchResponse("Exa similar-page search", response) }],
          details: {
            requestId: response.requestId,
            costDollars: response.costDollars,
            resultCount: response.results?.length ?? 0,
            results: response.results ?? [],
          },
        };
      },
    });

    pi.registerTool({
      name: "exa_get_contents",
      label: "Exa Get Contents",
      description: "Fetch clean page contents from known URLs you already know you want to inspect.",
      promptSnippet: "Fetch page contents from specific URLs with Exa.",
      promptGuidelines: [
        "Use exa_get_contents only after you already have the target URL or list of URLs.",
        "Prefer exa_search first when you still need to discover the right source.",
      ],
      parameters: Type.Object({
        urls: Type.Array(Type.String({ description: "URL to fetch." }), {
          minItems: 1,
          maxItems: 10,
          description: "URLs to fetch with Exa.",
        }),
        maxCharacters: Type.Optional(Type.Integer({ minimum: 500, maximum: 20000, description: "Character cap for returned page text." })),
        livecrawl: Type.Optional(Type.Boolean({ description: "Force fresh crawling with maxAgeHours=0." })),
      }),

      async execute(_toolCallId, params) {
        const client = getClient();
        const response = await client.getContents(params.urls, compactObject({
          text: { maxCharacters: params.maxCharacters ?? DEFAULT_CONTENT_CHARACTERS },
          livecrawlTimeout: DEFAULT_LIVECRAWL_TIMEOUT,
          maxAgeHours: params.livecrawl ? 0 : undefined,
        }));

        return {
          content: [{ type: "text", text: formatSearchResponse("Exa contents fetch", response) }],
          details: {
            requestId: response.requestId,
            costDollars: response.costDollars,
            resultCount: response.results?.length ?? 0,
            results: response.results ?? [],
          },
        };
      },
    });

    pi.registerTool({
      name: "exa_answer",
      label: "Exa Answer",
      description: "Get a direct answer with citations when the user wants the conclusion, not a list of candidate links.",
      promptSnippet: "Get a synthesized answer with citations from Exa.",
      promptGuidelines: [
        "Use exa_answer when the user wants a direct answer backed by web citations rather than raw search results.",
        "Use exa_search instead when the user wants to browse or compare candidate sources.",
        "Use exa_research_* for longer-running synthesis jobs that may need to be revisited later.",
      ],
      parameters: Type.Object({
        query: Type.String({ description: "Question to answer." }),
        text: Type.Optional(Type.Boolean({ description: "Allow Exa to use full page text." })),
        model: Type.Optional(StringEnum(ANSWER_MODELS, { description: "Answer model." })),
        systemPrompt: Type.Optional(Type.String({ description: "Optional answer instructions." })),
        userLocation: Type.Optional(Type.String({ description: "Two-letter ISO country code." })),
        outputSchema: Type.Optional(Type.Unknown({ description: "Optional JSON schema for structured answers." })),
        stream: Type.Optional(Type.Boolean({ description: "Stream partial answer text when supported." })),
      }),

      async execute(_toolCallId, params, _signal, onUpdate) {
        const client = getClient();
        const options = compactObject({
          text: params.text,
          model: params.model,
          systemPrompt: params.systemPrompt,
          userLocation: params.userLocation,
          outputSchema: params.outputSchema,
        });

        if (params.stream) {
          if (!client.streamAnswer) throw new Error("Installed exa-js client does not support streamAnswer().");

          let answerText = "";
          let citations: ExaResult[] = [];

          for await (const chunk of client.streamAnswer(params.query, options)) {
            if (chunk.content) {
              answerText += chunk.content;
              onUpdate?.({ content: [{ type: "text", text: answerText }] });
            }
            if (chunk.citations?.length) citations = chunk.citations;
          }

          return {
            content: [{
              type: "text",
              text: [
                "Exa answer",
                answerText || "",
                citations.length ? `Citations:\n${formatCitations(citations)}` : null,
              ].filter(Boolean).join("\n\n"),
            }],
            details: {
              answer: answerText,
              citations,
              streamed: true,
            },
          };
        }

        if (!client.answer) throw new Error("Installed exa-js client does not support answer().");

        const response = await client.answer(params.query, options);
        const cost = formatCost(response.costDollars?.total);

        return {
          content: [{
            type: "text",
            text: [
              ["Exa answer", cost].filter(Boolean).join(" · "),
              typeof response.answer === "string" ? response.answer : safeJson(response.answer),
              response.requestId ? `request ${response.requestId}` : null,
              response.citations?.length ? `Citations:\n${formatCitations(response.citations)}` : null,
            ].filter(Boolean).join("\n\n"),
          }],
          details: {
            requestId: response.requestId,
            costDollars: response.costDollars,
            answer: response.answer,
            citations: response.citations ?? [],
          },
        };
      },
    });

    pi.registerTool({
      name: "exa_research_create",
      label: "Exa Research Create",
      description: "Start an Exa research task for longer-running synthesis.",
      promptSnippet: "Start a long-running Exa research task.",
      parameters: Type.Object({
        instructions: Type.String({ description: "Research instructions." }),
        model: Type.Optional(StringEnum(RESEARCH_MODELS, { description: "Research model." })),
        outputSchema: Type.Optional(Type.Unknown({ description: "Optional JSON schema for structured output." })),
      }),

      async execute(_toolCallId, params) {
        const client = getClient();
        if (!client.research) throw new Error("Installed exa-js client does not support research APIs.");
        const research = await client.research.create(compactObject({
          instructions: params.instructions,
          model: params.model,
          outputSchema: params.outputSchema,
        }));

        return {
          content: [{ type: "text", text: formatResearch(research) }],
          details: research,
        };
      },
    });

    pi.registerTool({
      name: "exa_research_get",
      label: "Exa Research Get",
      description: "Get the current state of an Exa research task.",
      promptSnippet: "Fetch the current state of an Exa research task.",
      parameters: Type.Object({
        researchId: Type.String({ description: "Research task ID." }),
        events: Type.Optional(Type.Boolean({ description: "Include event log." })),
      }),

      async execute(_toolCallId, params) {
        const client = getClient();
        if (!client.research) throw new Error("Installed exa-js client does not support research APIs.");
        const research = await client.research.get(params.researchId, compactObject({ events: params.events }));

        return {
          content: [{ type: "text", text: formatResearch(research) }],
          details: research,
        };
      },
    });

    pi.registerTool({
      name: "exa_research_poll",
      label: "Exa Research Poll",
      description: "Poll an Exa research task until it finishes.",
      promptSnippet: "Wait for an Exa research task to finish.",
      parameters: Type.Object({
        researchId: Type.String({ description: "Research task ID." }),
        pollInterval: Type.Optional(Type.Integer({ minimum: 100, description: "Polling interval in milliseconds." })),
        timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, description: "Overall timeout in milliseconds." })),
        events: Type.Optional(Type.Boolean({ description: "Include event log." })),
      }),

      async execute(_toolCallId, params) {
        const client = getClient();
        if (!client.research) throw new Error("Installed exa-js client does not support research APIs.");
        const research = await client.research.pollUntilFinished(params.researchId, compactObject({
          pollInterval: params.pollInterval,
          timeoutMs: params.timeoutMs,
          events: params.events,
        }));

        return {
          content: [{ type: "text", text: formatResearch(research) }],
          details: research,
        };
      },
    });

    pi.registerTool({
      name: "exa_research_list",
      label: "Exa Research List",
      description: "List recent Exa research tasks.",
      promptSnippet: "List recent Exa research tasks.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Number of tasks to return." })),
        cursor: Type.Optional(Type.String({ description: "Pagination cursor." })),
      }),

      async execute(_toolCallId, params) {
        const client = getClient();
        if (!client.research) throw new Error("Installed exa-js client does not support research APIs.");
        const response = await client.research.list(compactObject({ limit: params.limit, cursor: params.cursor }));
        const lines = response.data?.length
          ? response.data.map((item, index) => `${index + 1}. ${item.researchId} — ${item.status ?? "unknown"}\n${item.instructions ?? ""}`).join("\n\n")
          : "No research tasks.";

        return {
          content: [{
            type: "text",
            text: truncate([
              `Research tasks: ${response.data?.length ?? 0}`,
              response.hasMore !== undefined ? `Has more: ${response.hasMore}` : null,
              response.nextCursor ? `Next cursor: ${response.nextCursor}` : null,
              "",
              lines,
            ].filter(Boolean).join("\n")),
          }],
          details: {
            count: response.data?.length ?? 0,
            hasMore: response.hasMore,
            nextCursor: response.nextCursor,
            data: response.data ?? [],
          },
        };
      },
    });

    pi.registerCommand("exa", {
      description: "Show Exa setup status",
      handler: async (_args, ctx) => {
        const configured = !!process.env.EXA_API_KEY;
        ctx.ui.notify(
          configured
            ? "Exa is configured. Tools: exa_search, exa_find_similar, exa_get_contents, exa_answer, exa_research_*"
            : "Exa is not configured. Set EXA_API_KEY to use the Exa tools.",
          configured ? "success" : "error",
        );
      },
    });

    pi.setActiveTools([...CORE_TOOL_NAMES]);
  };
}

export default createExaExtension();
