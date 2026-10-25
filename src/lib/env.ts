export function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length < 32) {
    if (isProd()) throw new Error("SESSION_SECRET must be set to at least 32 characters");
    return "insecure-dev-secret-insecure-dev-secret";
  }
  return s;
}

export function appUrl(): string {
  return env("APP_URL", "http://localhost:3000").replace(/\/$/, "");
}
