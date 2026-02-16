import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@core/(.*)$": "<rootDir>/src/core/$1",
    "^@api/(.*)$": "<rootDir>/src/api/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

export default config;
