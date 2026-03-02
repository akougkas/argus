import { describe, test, expect } from "bun:test";
import { buildSteeringCommand } from "../../../src/probe/steering";

describe("buildSteeringCommand", () => {
  test("stoprun with valid run ID returns /stoprun command", () => {
    expect(buildSteeringCommand("stoprun", "run-abc-123")).toBe("/stoprun run-abc-123\n");
  });

  test("steer with valid message returns /steer command", () => {
    expect(buildSteeringCommand("steer", "focus on tests")).toBe("/steer focus on tests\n");
  });

  test("stoprun with empty content returns null", () => {
    expect(buildSteeringCommand("stoprun", "")).toBeNull();
  });

  test("steer with empty content returns null", () => {
    expect(buildSteeringCommand("steer", "")).toBeNull();
  });

  test("stoprun with undefined content returns null", () => {
    expect(buildSteeringCommand("stoprun", undefined)).toBeNull();
  });

  test("steer with undefined content returns null", () => {
    expect(buildSteeringCommand("steer", undefined)).toBeNull();
  });

  test("content gets trimmed", () => {
    expect(buildSteeringCommand("stoprun", "  run-xyz  ")).toBe("/stoprun run-xyz\n");
    expect(buildSteeringCommand("steer", "  do something  ")).toBe("/steer do something\n");
  });

  test("stoprun with whitespace-only content returns null", () => {
    expect(buildSteeringCommand("stoprun", "   ")).toBeNull();
  });

  test("steer with whitespace-only content returns null", () => {
    expect(buildSteeringCommand("steer", "   ")).toBeNull();
  });
});
