import { describe, test, expect } from "bun:test";
import { extractJSON } from "../../probe-utils";

describe("extractJSON", () => {
  test("parses raw valid JSON", () => {
    const result = extractJSON('{"agent_state":"STUCK","confidence_score":80,"reasoning":"loop"}');
    expect(result).toEqual({ agent_state: "STUCK", confidence_score: 80, reasoning: "loop" });
  });

  test("extracts JSON from fenced code block", () => {
    const input = 'Here is the analysis:\n```json\n{"agent_state":"DANGEROUS","confidence_score":90,"reasoning":"rm -rf"}\n```';
    const result = extractJSON(input);
    expect(result?.agent_state).toBe("DANGEROUS");
    expect(result?.confidence_score).toBe(90);
  });

  test("extracts JSON from fenced block without language tag", () => {
    const input = '```\n{"agent_state":"STUCK","confidence_score":50,"reasoning":"build fail"}\n```';
    const result = extractJSON(input);
    expect(result?.agent_state).toBe("STUCK");
  });

  test("extracts embedded JSON from surrounding text", () => {
    const input = 'The analysis shows {"agent_state":"HALLUCINATING","confidence_score":70,"reasoning":"fake commands"} based on output';
    const result = extractJSON(input);
    expect(result?.agent_state).toBe("HALLUCINATING");
  });

  test("returns null for malformed JSON", () => {
    expect(extractJSON("{not valid json}")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractJSON("")).toBeNull();
  });

  test("returns null for text with no JSON", () => {
    expect(extractJSON("ANOMALY detected in terminal output")).toBeNull();
  });

  test("handles nested braces correctly", () => {
    const input = '{"agent_state":"STUCK","confidence_score":60,"reasoning":"nested {brace} test"}';
    const result = extractJSON(input);
    expect(result?.agent_state).toBe("STUCK");
    expect(result?.reasoning).toBe("nested {brace} test");
  });

  test("picks outermost braces for embedded extraction", () => {
    const input = 'prefix {"agent_state":"STUCK","confidence_score":50,"reasoning":"a"} suffix';
    const result = extractJSON(input);
    expect(result?.agent_state).toBe("STUCK");
  });
});
