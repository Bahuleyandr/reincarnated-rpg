import { COST_CAPS_USD } from "@/lib/ai/cost-gate";

describe("cost cap table", () => {
  test("free is $0.50, supporter $2, patron $10", () => {
    expect(COST_CAPS_USD.free).toBe(0.5);
    expect(COST_CAPS_USD.supporter).toBe(2);
    expect(COST_CAPS_USD.patron).toBe(10);
  });
});
