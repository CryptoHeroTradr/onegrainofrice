import { describe, expect, it } from "vitest";
import {
  LOOKS,
  DEFAULT_LOOK,
  SIMPLE_PROMPT,
  buildGeneratePrompt,
  findLook,
} from "@/lib/pfp/prompts";

/**
 * The PFP generator's prompt table is now the single seam where three former
 * features meet — AI Enhance, the Rice Art Generator and Generate New PFP all
 * became a `look` here. These are pure-function assertions in the spirit of the
 * rest of test/: cheap to run, and they pin the two things a silent edit would
 * otherwise break without anyone noticing until an image came back wrong.
 */
describe("pfp look table", () => {
  it("carries every look the three old generators offered", () => {
    const ids = LOOKS.map((l) => l.id);
    for (const id of [
      // was Generate New PFP
      "rice-pfp",
      // was AI Enhance
      "realistic",
      "anime",
      "painting",
      "pixel",
      "custom",
      // was the Rice Art Generator
      "sacred-grain",
      "paddy-fields",
      "degen-rice",
      "ancient-scroll",
      "neon-rice",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("defaults to the old Generate New PFP behaviour", () => {
    expect(DEFAULT_LOOK).toBe("rice-pfp");
    expect(findLook(undefined).id).toBe("rice-pfp");
    expect(findLook("not-a-look").id).toBe("rice-pfp");
  });

  it("every look but custom ships a prompt", () => {
    for (const look of LOOKS) {
      if (look.id === "custom") expect(look.prompt).toBe("");
      else expect(look.prompt.length).toBeGreaterThan(20);
    }
  });
});

describe("buildGeneratePrompt", () => {
  it("appends the user's words to the look", () => {
    const out = buildGeneratePrompt({
      look: "anime",
      prompt: "golden hour",
      hasReference: true,
    });
    expect(out).toContain("anime/manga art style");
    expect(out.endsWith("golden hour")).toBe(true);
  });

  it("uses the user's words alone for the custom look", () => {
    expect(buildGeneratePrompt({ look: "custom", prompt: "a duck", hasReference: true })).toBe(
      "a duck",
    );
    // Nothing to say and nothing to fall back on — the route rejects this.
    expect(buildGeneratePrompt({ look: "custom", prompt: "  ", hasReference: true })).toBe("");
  });

  it("reimagines the reference for art looks, and only when there is one", () => {
    const withRef = buildGeneratePrompt({ look: "neon-rice", hasReference: true });
    const without = buildGeneratePrompt({ look: "neon-rice", hasReference: false });
    expect(withRef).toContain("reference image");
    expect(without).not.toContain("reference image");
    // Portrait looks act on the composition either way — no reimagine wrapper.
    expect(buildGeneratePrompt({ look: "realistic", hasReference: true })).not.toContain(
      "reference image",
    );
  });
});

describe("the /home one-shot prompt", () => {
  // Pinned verbatim: /home offers no look picker, so this string IS that
  // feature. Changing it changes what every visitor's generate does.
  it("is the rice hat + bowl instruction, unchanged", () => {
    expect(SIMPLE_PROMPT).toBe(
      "add a rice farmer hat and add a bowl of white steamy rice in characters hand. " +
        "Keep the same style of art the uploaded image has. Change nothing else",
    );
  });
});
