import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/e2e/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // `uuid` v14 ships pure ESM; let Jest transform it via next/jest's SWC.
  transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "!src/lib/db/migrations/**",
    "!src/**/*.d.ts",
  ],
};

export default createJestConfig(config);
