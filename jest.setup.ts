// Jest setup runs after Jest is loaded but before tests.
// Loads .env.local so tests pick up DATABASE_URL etc.
import "./scripts/load-env";
export {};
