export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins?: readonly string[];
  readonly tls?: {
    readonly keyPath: string;
    readonly certPath: string;
  };
}

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;

export function readServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const host = environment.HOST?.trim() || DEFAULT_HOST;
  const rawPort = environment.PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const keyPath = environment.TLS_KEY_PATH?.trim();
  const certPath = environment.TLS_CERT_PATH?.trim();
  if (Boolean(keyPath) !== Boolean(certPath)) {
    throw new Error(
      "TLS_KEY_PATH and TLS_CERT_PATH must be configured together",
    );
  }
  const allowedOrigins = environment.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    host,
    port,
    ...(allowedOrigins?.length ? { allowedOrigins } : {}),
    ...(keyPath && certPath ? { tls: { keyPath, certPath } } : {}),
  };
}
