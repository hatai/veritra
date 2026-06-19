import { describe, it, expect } from "vitest";
import { add } from "./health";

describe("add", () => {
  it("sums two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
