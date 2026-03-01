import { describe, test, expect } from "bun:test";

// Test the anomaly detection logic extracted from probe.ts tier1
// This is the same logic used in the fast perception loop
function isAnomaly(result: string): boolean {
  const upper = result.trim().toUpperCase();
  return (
    upper.includes("ANOMALY") ||
    (!upper.includes("OK") && (upper.includes("ERROR") || upper.includes("FAIL")))
  );
}

describe("tier1 anomaly detection", () => {
  test("ANOMALY is anomaly", () => {
    expect(isAnomaly("ANOMALY")).toBe(true);
  });

  test("OK is not anomaly", () => {
    expect(isAnomaly("OK")).toBe(false);
  });

  test("ok (lowercase) is not anomaly", () => {
    expect(isAnomaly("ok")).toBe(false);
  });

  test("anomaly (lowercase) is anomaly", () => {
    expect(isAnomaly("anomaly")).toBe(true);
  });

  test("empty string is not anomaly", () => {
    expect(isAnomaly("")).toBe(false);
  });

  test("ERROR without OK is anomaly", () => {
    expect(isAnomaly("ERROR")).toBe(true);
  });

  test("FAIL without OK is anomaly", () => {
    expect(isAnomaly("FAIL")).toBe(true);
  });

  test("OK with ERROR is not anomaly (OK takes precedence)", () => {
    // This matches the probe logic: if result includes OK, we don't check ERROR/FAIL
    expect(isAnomaly("OK ERROR")).toBe(false);
  });

  test("ANOMALY always wins even with OK", () => {
    expect(isAnomaly("ANOMALY OK")).toBe(true);
  });

  test("whitespace-padded OK is not anomaly", () => {
    expect(isAnomaly("  OK  ")).toBe(false);
  });

  test("FAILURE is anomaly", () => {
    expect(isAnomaly("FAILURE")).toBe(true);
  });

  test("random text is not anomaly", () => {
    expect(isAnomaly("PROGRESSING")).toBe(false);
  });
});
