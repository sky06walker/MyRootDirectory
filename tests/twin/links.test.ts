import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OwnerLinks, guardLinks, ownerLinks } from "../../functions/_lib/twin/links";
import { toTwinCv } from "../../functions/_lib/twin/cv";
import { handleChat } from "../../functions/_lib/twin/handler";
import { resetTwinCaches } from "../../functions/_lib/twin/cv";
import { buildSystemPrompt } from "../../functions/_lib/twin/prompt";
import type { CVData } from "../../src/utils/types";
import { SAMPLE_CV, completion, fakeKv, makeEnv, makeFetch, MemoryStore } from "../helpers/fakes";

const LINKEDIN = "https://www.linkedin.com/in/chong-wei-hon-976026ab/";
const GITHUB = "https://github.com/sky06walker";
const links: OwnerLinks = { allowed: [LINKEDIN, GITHUB], linkedin: LINKEDIN };
const guard = (text: string, l = links) => guardLinks(text, l).text;

describe("guardLinks", () => {
  it("keeps the owner's real links (any trailing slash or letter case), in canonical form", () => {
    expect(guard(`Find me at ${LINKEDIN}`)).toBe(`Find me at ${LINKEDIN}`);
    expect(guard("Find me at https://www.linkedin.com/in/chong-wei-hon-976026ab")).toBe(`Find me at ${LINKEDIN}`);
    expect(guard("See HTTPS://WWW.LINKEDIN.COM/IN/CHONG-WEI-HON-976026AB.")).toBe(`See ${LINKEDIN}.`);
    expect(guard(`Code: ${GITHUB}!`)).toBe(`Code: ${GITHUB}!`);
    expect(guardLinks(`${LINKEDIN}`, links).changed).toBe(false);
  });

  it("replaces a mis-copied or invented LinkedIn profile with the real one", () => {
    expect(guard("https://www.linkedin.com/in/chong-wei-hon")).toBe(LINKEDIN);
    expect(guard("My profile (https://linkedin.com/in/someone-else/).")).toBe(`My profile (${LINKEDIN}).`);
    expect(guard("https://my.linkedin.com/in/x?trk=abc, thanks")).toBe(`${LINKEDIN}, thanks`);
    expect(guardLinks("https://www.linkedin.com/in/chong-wei-hon", links).changed).toBe(true);
  });

  it("handles LinkedIn written without a scheme, without doubling real links", () => {
    expect(guard("Add me: linkedin.com/in/chong-wei-hon")).toBe(`Add me: ${LINKEDIN}`);
    expect(guard("Add me: www.linkedin.com/in/some-one/.")).toBe(`Add me: ${LINKEDIN}.`);
    expect(guard(`Both: ${LINKEDIN} and linkedin.com/in/wrong`)).toBe(`Both: ${LINKEDIN} and ${LINKEDIN}`);
    expect(guard(`Only one: ${LINKEDIN}`)).toBe(`Only one: ${LINKEDIN}`); // not matched a second time inside the full URL
  });

  it("removes every other link (including look-alikes and phishing)", () => {
    expect(guard("Visit https://evil.example/login now")).toBe("Visit [link removed] now");
    expect(guard("https://github.com/someone-else and https://www.linkedin.com.evil.example/in/x")).toBe("[link removed] and [link removed]");
    expect(guard("http://sky06walker.github.io/x?a=1&b=2.")).toBe("[link removed].");
    expect(guard("See https://example.com, https://example.org!")).toBe("See [link removed], [link removed]!");
  });

  it("leaves everything else alone", () => {
    for (const text of ["I work at n2n connect bhd.", "Email me at c.weihon@outlook.com.", "Salary: n/a", "", "version 1.2.3 and example.com/page"]) {
      expect(guard(text)).toBe(text);
    }
    expect(guardLinks("plain text", links).changed).toBe(false);
  });

  it("without a LinkedIn profile in the CV, LinkedIn mentions are removed rather than invented", () => {
    const none = { allowed: [GITHUB], linkedin: undefined };
    expect(guard("https://www.linkedin.com/in/anyone and linkedin.com/in/x", none)).toBe("[link removed] and [link removed]");
  });
});

describe("ownerLinks", () => {
  const cvWith = (over: Partial<CVData["contact"]>, url = LINKEDIN) =>
    toTwinCv({ ...(SAMPLE_CV as unknown as CVData), profile: { ...(SAMPLE_CV.profile as CVData["profile"]), url }, contact: { ...(SAMPLE_CV.contact as CVData["contact"]), ...over } });

  it("collects the CV's http(s) links and picks the real LinkedIn one", () => {
    const l = ownerLinks(cvWith({ linkedin: LINKEDIN, github: GITHUB }));
    expect(l.allowed).toEqual([LINKEDIN, GITHUB]);
    expect(l.linkedin).toBe(LINKEDIN);
  });

  it("does not treat a non-LinkedIn website as LinkedIn, and ignores non-http values", () => {
    const l = ownerLinks(cvWith({ linkedin: undefined, github: "javascript:alert(1)", website: "https://example.org" }, "https://example.org"));
    expect(l.linkedin).toBeUndefined();
    expect(l.allowed).toEqual(["https://example.org"]);
  });
});

describe("chat answers carry only real links", () => {
  beforeEach(() => {
    resetTwinCaches();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const ask = async (answer: string, cv: unknown = { ...SAMPLE_CV, profile: { ...SAMPLE_CV.profile, url: LINKEDIN }, contact: { ...SAMPLE_CV.contact, linkedin: LINKEDIN, github: GITHUB } }) => {
    const env = makeEnv({ TWIN_REQUIRE_TURNSTILE: "false", TURNSTILE_SECRET_KEY: undefined }, fakeKv({ cv_content: JSON.stringify(cv) }));
    const fetcher = makeFetch({ upstream: () => completion(answer) });
    const res = await handleChat(
      new Request("https://cv.example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://cv.example.com", "CF-Ray": "x", "CF-Connecting-IP": "203.0.113.7" },
        body: JSON.stringify({ messages: [{ role: "user", content: "What is your LinkedIn?" }] }),
      }),
      env,
      { store: new MemoryStore(), fetchImpl: fetcher.impl },
    );
    return ((await res.json()) as { answer: string }).answer;
  };

  it("fixes a wrong LinkedIn link the model wrote", async () => {
    expect(await ask("You can find me at https://www.linkedin.com/in/chong-wei-hon-wrong")).toBe(`You can find me at ${LINKEDIN}`);
  });

  it("drops a link that is not in the CV", async () => {
    expect(await ask("Check https://evil.example/phish for more.")).toBe("Check [link removed] for more.");
  });

  it("keeps a correct answer untouched", async () => {
    expect(await ask(`LinkedIn: ${LINKEDIN}\nGitHub: ${GITHUB}`)).toBe(`LinkedIn: ${LINKEDIN}\nGitHub: ${GITHUB}`);
  });

  it("the prompt tells the model to copy links exactly", () => {
    const prompt = buildSystemPrompt({ cv: toTwinCv(SAMPLE_CV as unknown as CVData), faq: "", asOf: new Date("2026-11-22T00:00:00Z") });
    expect(prompt).toMatch(/copy it exactly from CV DATA\. Never shorten, guess or invent a URL/);
  });
});
