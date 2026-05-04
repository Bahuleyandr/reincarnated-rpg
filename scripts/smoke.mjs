const baseUrl = process.env.SMOKE_BASE_URL ?? process.argv[2] ?? "http://127.0.0.1:3000";

const response = await fetch(new URL("/api/health", baseUrl));
if (!response.ok) {
  console.error(`[smoke] /api/health returned ${response.status}`);
  process.exit(1);
}

const body = await response.json();
if (body.status !== "ok") {
  console.error(`[smoke] unexpected health payload: ${JSON.stringify(body)}`);
  process.exit(1);
}

console.log(`[smoke] ok ${baseUrl}`);
