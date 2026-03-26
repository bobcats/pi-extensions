import test from "node:test";
import assert from "node:assert/strict";
import exaExtension, { createExaExtension } from "./index.ts";

function createPiHarness() {
  const tools: Array<{ name: string; execute: Function }> = [];
  const commands = new Map<string, { handler: Function }>();
  const activeToolCalls: string[][] = [];

  return {
    tools,
    commands,
    activeToolCalls,
    pi: {
      registerTool(tool: { name: string; execute: Function }) {
        tools.push(tool);
      },
      registerCommand(name: string, command: { handler: Function }) {
        commands.set(name, command);
      },
      setActiveTools(names: string[]) {
        activeToolCalls.push(names);
      },
    } as never,
  };
}

test("registers exa tools and command", async () => {
  const harness = createPiHarness();

  createExaExtension(() => {
    throw new Error("should not instantiate client during registration");
  })(harness.pi);

  assert.deepEqual(harness.tools.map((tool) => tool.name), [
    "exa_search",
    "exa_find_similar",
    "exa_get_contents",
    "exa_answer",
    "exa_research_create",
    "exa_research_get",
    "exa_research_poll",
    "exa_research_list",
  ]);
  assert.ok(harness.commands.has("exa"));
});

test("enables only the core Exa tools by default", async () => {
  const harness = createPiHarness();

  createExaExtension(() => ({
    getContents: async () => ({ results: [] }),
  }))(harness.pi);

  assert.deepEqual(harness.activeToolCalls, [[
    "exa_search",
    "exa_get_contents",
    "exa_answer",
  ]]);
});

test("core tool definitions explain when to use each workflow", async () => {
  const harness = createPiHarness();

  createExaExtension(() => ({ getContents: async () => ({ results: [] }) }))(harness.pi);

  const search = harness.tools.find((tool) => tool.name === "exa_search") as { description?: string; promptGuidelines?: string[] } | undefined;
  const contents = harness.tools.find((tool) => tool.name === "exa_get_contents") as { description?: string; promptGuidelines?: string[] } | undefined;
  const answer = harness.tools.find((tool) => tool.name === "exa_answer") as { description?: string; promptGuidelines?: string[] } | undefined;

  assert.match(search?.description ?? "", /exploratory/i);
  assert.match(contents?.description ?? "", /known urls?/i);
  assert.match(answer?.description ?? "", /direct answer/i);
});

test("exa_search uses EXA_API_KEY env and forwards search options", async () => {
  const harness = createPiHarness();
  let receivedApiKey: string | undefined;
  let receivedQuery: string | undefined;
  let receivedOptions: Record<string, unknown> | undefined;

  const previousApiKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";

  try {
    createExaExtension((apiKey) => {
      receivedApiKey = apiKey;
      return {
        search: async (query: string, options: Record<string, unknown>) => {
          receivedQuery = query;
          receivedOptions = options;
          return {
            requestId: "req_123",
            costDollars: { total: 0.01 },
            results: [
              {
                title: "Exa result",
                url: "https://example.com",
                publishedDate: "2025-01-01",
                highlights: ["useful highlight"],
              },
            ],
          };
        },
      };
    })(harness.pi);

    const search = harness.tools.find((tool) => tool.name === "exa_search");
    assert.ok(search);

    const result = await search.execute("call_1", {
      query: "pi extension api",
      type: "fast",
      numResults: 3,
      highlights: true,
      text: false,
      livecrawl: true,
      includeDomains: ["exa.ai"],
      category: "news",
    });

    assert.equal(receivedApiKey, "test-key");
    assert.equal(receivedQuery, "pi extension api");
    assert.deepEqual(receivedOptions, {
      type: "fast",
      numResults: 3,
      includeDomains: ["exa.ai"],
      category: "news",
      contents: {
        highlights: { maxCharacters: 4000 },
        text: false,
        livecrawlTimeout: 10000,
        maxAgeHours: 0,
      },
    });
    assert.match(result.content[0].text, /^Exa search · 1 result\(s\) · \$0\.0100/m);
    assert.match(result.content[0].text, /1\. Exa result/);
    assert.match(result.content[0].text, /↳ useful highlight/);
    assert.deepEqual(result.details, {
      requestId: "req_123",
      costDollars: { total: 0.01 },
      resultCount: 1,
      results: [
        {
          title: "Exa result",
          url: "https://example.com",
          publishedDate: "2025-01-01",
          highlights: ["useful highlight"],
        },
      ],
    });
  } finally {
    if (previousApiKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previousApiKey;
  }
});

test("exa_find_similar forwards url and content options", async () => {
  const harness = createPiHarness();

  createExaExtension(() => ({
    findSimilar: async (url: string, options: Record<string, unknown>) => {
      assert.equal(url, "https://example.com/source");
      assert.deepEqual(options, {
        numResults: 2,
        excludeSourceDomain: true,
        contents: {
          highlights: { maxCharacters: 4000 },
          text: { maxCharacters: 6000 },
        },
      });

      return {
        requestId: "req_similar",
        results: [
          {
            title: "Related page",
            url: "https://example.com/related",
            highlights: ["Related highlight"],
          },
        ],
      };
    },
  }))(harness.pi);

  const findSimilar = harness.tools.find((tool) => tool.name === "exa_find_similar");
  assert.ok(findSimilar);

  const result = await findSimilar.execute("call_2", {
    url: "https://example.com/source",
    numResults: 2,
    excludeSourceDomain: true,
    text: true,
    maxCharacters: 6000,
  });

  assert.match(result.content[0].text, /^Exa similar-page search · 1 result\(s\)/m);
  assert.match(result.content[0].text, /1\. Related page/);
  assert.match(result.content[0].text, /↳ Related highlight/);
  assert.equal(result.details.requestId, "req_similar");
});

test("exa_get_contents fetches page text for urls", async () => {
  const harness = createPiHarness();

  createExaExtension(() => ({
    getContents: async (
      urls: string[],
      options: { text: { maxCharacters: number }; livecrawlTimeout?: number; maxAgeHours?: number },
    ) => {
      assert.deepEqual(urls, ["https://example.com/a", "https://example.com/b"]);
      assert.deepEqual(options, {
        text: { maxCharacters: 5000 },
        livecrawlTimeout: 10000,
      });

      return {
        requestId: "req_contents",
        costDollars: { total: 0.02 },
        results: [
          {
            url: "https://example.com/a",
            title: "Example A",
            text: "Alpha content",
          },
        ],
      };
    },
  }))(harness.pi);

  const getContents = harness.tools.find((tool) => tool.name === "exa_get_contents");
  assert.ok(getContents);

  const result = await getContents.execute("call_3", {
    urls: ["https://example.com/a", "https://example.com/b"],
    maxCharacters: 5000,
  });

  assert.match(result.content[0].text, /^Exa contents fetch · 1 result\(s\) · \$0\.0200/m);
  assert.match(result.content[0].text, /1\. Example A/);
  assert.match(result.content[0].text, /Alpha content/);
  assert.equal(result.details.requestId, "req_contents");
  assert.equal(result.details.resultCount, 1);
});

test("exa_answer forwards answer options and formats citations", async () => {
  const harness = createPiHarness();

  createExaExtension(() => ({
    answer: async (query: string, options: Record<string, unknown>) => {
      assert.equal(query, "What is pi?");
      assert.deepEqual(options, {
        text: true,
        model: "exa-pro",
        systemPrompt: "Answer tersely",
      });

      return {
        requestId: "req_answer",
        costDollars: { total: 0.03 },
        answer: "Pi is approximately 3.14159.",
        citations: [
          {
            title: "Pi reference",
            url: "https://example.com/pi",
          },
        ],
      };
    },
  }))(harness.pi);

  const answer = harness.tools.find((tool) => tool.name === "exa_answer");
  assert.ok(answer);

  const result = await answer.execute("call_4", {
    query: "What is pi?",
    text: true,
    model: "exa-pro",
    systemPrompt: "Answer tersely",
  });

  assert.match(result.content[0].text, /^Exa answer · \$0\.0300/m);
  assert.match(result.content[0].text, /Pi is approximately 3.14159/);
  assert.match(result.content[0].text, /1\. Pi reference/);
  assert.deepEqual(result.details, {
    requestId: "req_answer",
    costDollars: { total: 0.03 },
    answer: "Pi is approximately 3.14159.",
    citations: [
      {
        title: "Pi reference",
        url: "https://example.com/pi",
      },
    ],
  });
});

test("exa_answer streams chunks when stream is requested", async () => {
  const harness = createPiHarness();
  const updates: unknown[] = [];

  createExaExtension(() => ({
    streamAnswer: async function* (query: string, options: Record<string, unknown>) {
      assert.equal(query, "Stream pi");
      assert.deepEqual(options, {
        text: true,
        model: "exa",
      });

      yield { content: "Pi " };
      yield { content: "streams.", citations: [{ title: "Citation", url: "https://example.com/citation" }] };
    },
  }))(harness.pi);

  const answer = harness.tools.find((tool) => tool.name === "exa_answer");
  assert.ok(answer);

  const result = await answer.execute(
    "call_4b",
    {
      query: "Stream pi",
      text: true,
      model: "exa",
      stream: true,
    },
    undefined,
    (update: unknown) => {
      updates.push(update);
    },
  );

  assert.equal(updates.length, 2);
  assert.match((updates[0] as { content: Array<{ text: string }> }).content[0].text, /Pi /);
  assert.match(result.content[0].text, /Pi streams\./);
  assert.match(result.content[0].text, /Citation/);
});

test("research tools create, poll, get, and list research tasks", async () => {
  const harness = createPiHarness();

  createExaExtension(() => ({
    research: {
      create: async (params: Record<string, unknown>) => {
        assert.deepEqual(params, {
          instructions: "Research recent Exa launches",
          model: "exa-research-fast",
        });

        return { researchId: "r_123", status: "pending" };
      },
      get: async (researchId: string, options: Record<string, unknown>) => {
        assert.equal(researchId, "r_123");
        assert.deepEqual(options, { events: true });
        return {
          researchId: "r_123",
          status: "completed",
          instructions: "Research recent Exa launches",
          output: { text: "Launch summary" },
        };
      },
      pollUntilFinished: async (researchId: string, options: Record<string, unknown>) => {
        assert.equal(researchId, "r_123");
        assert.deepEqual(options, { pollInterval: 500, timeoutMs: 2000, events: true });
        return {
          researchId: "r_123",
          status: "completed",
          instructions: "Research recent Exa launches",
          output: { text: "Final summary" },
        };
      },
      list: async (options: Record<string, unknown>) => {
        assert.deepEqual(options, { limit: 5 });
        return {
          data: [
            { researchId: "r_123", status: "completed", instructions: "Research recent Exa launches" },
          ],
          hasMore: false,
        };
      },
    },
  }))(harness.pi);

  const create = harness.tools.find((tool) => tool.name === "exa_research_create");
  const get = harness.tools.find((tool) => tool.name === "exa_research_get");
  const poll = harness.tools.find((tool) => tool.name === "exa_research_poll");
  const list = harness.tools.find((tool) => tool.name === "exa_research_list");
  assert.ok(create && get && poll && list);

  const createResult = await create.execute("call_5", {
    instructions: "Research recent Exa launches",
    model: "exa-research-fast",
  });
  assert.match(createResult.content[0].text, /r_123/);

  const getResult = await get.execute("call_6", {
    researchId: "r_123",
    events: true,
  });
  assert.match(getResult.content[0].text, /Launch summary/);

  const pollResult = await poll.execute("call_7", {
    researchId: "r_123",
    pollInterval: 500,
    timeoutMs: 2000,
    events: true,
  });
  assert.match(pollResult.content[0].text, /Final summary/);

  const listResult = await list.execute("call_8", { limit: 5 });
  assert.match(listResult.content[0].text, /Research recent Exa launches/);
  assert.equal(listResult.details.count, 1);
});

test("exa_search throws when EXA_API_KEY is missing", async () => {
  const harness = createPiHarness();
  const previousApiKey = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;

  try {
    exaExtension(harness.pi);

    const search = harness.tools.find((tool) => tool.name === "exa_search");
    assert.ok(search);

    await assert.rejects(
      () => search.execute("call_9", { query: "test" }),
      /EXA_API_KEY is not set/
    );
  } finally {
    if (previousApiKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previousApiKey;
  }
});
