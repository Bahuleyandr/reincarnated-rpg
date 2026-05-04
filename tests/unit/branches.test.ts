import {
  clearBranchCache,
  loadBranch,
  pickWinner,
} from "@/lib/story/branches";

describe("branch loader", () => {
  beforeEach(() => clearBranchCache());

  test("loads Branch 1 from content/", () => {
    const b = loadBranch(1);
    expect(b).not.toBeNull();
    expect(b!.chapterId).toBe(4);
    expect(b!.paths.length).toBeGreaterThanOrEqual(2);
  });

  test("returns null for missing branch", () => {
    expect(loadBranch(999)).toBeNull();
  });
});

describe("pickWinner", () => {
  const paths = [
    { id: "a", label: "A", metric: "x" },
    { id: "b", label: "B", metric: "y" },
    { id: "c", label: "C", metric: "z" },
  ];

  test("picks the path with the highest metric", () => {
    expect(pickWinner(paths, { x: 5, y: 8, z: 3 }, "a")).toBe("b");
  });

  test("ties resolve to defaultPath", () => {
    expect(pickWinner(paths, { x: 5, y: 5, z: 1 }, "c")).toBe("c");
  });

  test("missing metrics treated as 0", () => {
    expect(pickWinner(paths, { x: 1 }, "a")).toBe("a");
  });

  test("all-zero ties → defaultPath", () => {
    expect(pickWinner(paths, {}, "b")).toBe("b");
  });
});
