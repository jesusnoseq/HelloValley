export interface ServerConfig {
  port: number;
  host: string;
}

/**
 * Reads the listen address from the environment. Local dev defaults to 127.0.0.1:2567.
 * TODO(M38): fly.toml sets PORT=8080 and HOST=0.0.0.0 (architecture §3.1).
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PORT: ${env.PORT}`);
  return { port, host: env.HOST || "127.0.0.1" };
}
