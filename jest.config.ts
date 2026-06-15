import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/e2e/"],
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // `jose` and `uuid` ship pure ESM; let Jest transform via next/jest's SWC.
  transformIgnorePatterns: ["node_modules/(?!(uuid|jose)/)"],
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "!src/lib/db/migrations/**",
    "!src/**/*.d.ts",
  ],
};

export default createJestConfig(config);
