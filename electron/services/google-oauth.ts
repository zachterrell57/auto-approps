import { shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import {
  GOOGLE_OAUTH_CLIENT_ID,
  getGoogleOAuthClientSecret,
} from "./config";
import {
  clearGoogleOAuth,
  readGoogleOAuth,
  writeGoogleOAuth,
  type GoogleOAuthSettings,
} from "./settings-store";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

const AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 60 * 1000;

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/forms.body.readonly",
  "openid",
  "email",
];
const REQUIRED_GOOGLE_FORMS_SCOPE = "https://www.googleapis.com/auth/forms.body.readonly";

export type GoogleOAuthErrorCode =
  | "user_cancelled"
  | "timeout"
  | "invalid_grant"
  | "misconfigured"
  | "insufficient_scope"
  | "not_connected"
  | "connect_in_progress"
  | "token_exchange_failed"
  | "oauth_failed";

export class GoogleOAuthError extends Error {
  code: GoogleOAuthErrorCode;

  constructor(code: GoogleOAuthErrorCode, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

export interface GoogleAuthStatus {
  connected: boolean;
  email: string;
}

interface TokenEndpointResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface ActiveConnectFlow {
  cancel: (message?: string) => void;
}

let activeConnectFlow: ActiveConnectFlow | null = null;

function ensureGoogleOAuthConfigured(): { clientId: string; clientSecret: string } {
  const clientId = GOOGLE_OAUTH_CLIENT_ID.trim();
  if (
    !clientId ||
    clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID") ||
    !clientId.endsWith(".apps.googleusercontent.com")
  ) {
    throw new GoogleOAuthError(
      "misconfigured",
      "Google OAuth client ID is not configured. Set GOOGLE_OAUTH_CLIENT_ID in config before connecting Google.",
    );
  }
  return {
    clientId,
    clientSecret: getGoogleOAuthClientSecret().trim(),
  };
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildPkceVerifier(): string {
  return base64UrlEncode(randomBytes(64));
}

function buildPkceChallenge(verifier: string): string {
  const digest = createHash("sha256").update(verifier).digest();
  return base64UrlEncode(digest);
}

function decodeEmailFromIdToken(idToken?: string): string {
  if (!idToken) return "";
  const segments = idToken.split(".");
  if (segments.length < 2) return "";
  try {
    const payload = Buffer.from(segments[1], "base64url").toString("utf8");
    const data = JSON.parse(payload) as Record<string, unknown>;
    return typeof data.email === "string" ? data.email : "";
  } catch {
    return "";
  }
}

function parseTokenResponse(body: string): TokenEndpointResponse {
  try {
    const parsed = JSON.parse(body) as TokenEndpointResponse;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Fall through to empty response.
  }
  return {};
}

function parseScopeSet(scope: string): Set<string> {
  return new Set(
    scope
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function hasRequiredGoogleFormsScope(scope: string): boolean {
  return parseScopeSet(scope).has(REQUIRED_GOOGLE_FORMS_SCOPE);
}

function ensureRequiredGoogleFormsScope(scope: string): void {
  if (hasRequiredGoogleFormsScope(scope)) return;
  throw new GoogleOAuthError(
    "insufficient_scope",
    "Google authorized the account, but the Forms API scope was not granted. " +
      `Add "${REQUIRED_GOOGLE_FORMS_SCOPE}" in Google Cloud OAuth consent screen, ` +
      "then disconnect and reconnect Google in Settings.",
  );
}

function tokenExpiresAt(expiresIn: number | undefined): number {
  const ttlSeconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
  return Date.now() + Math.max(0, ttlSeconds - 60) * 1000;
}

async function exchangeAuthorizationCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  previousRefreshToken?: string;
}): Promise<GoogleOAuthSettings> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    code: args.code,
    code_verifier: args.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
  });
  if (args.clientSecret) {
    body.set("client_secret", args.clientSecret);
  }

  const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const raw = await resp.text();
  const payload = parseTokenResponse(raw);

  if (!resp.ok) {
    if (
      (payload.error_description || "").toLowerCase().includes("client_secret is missing") &&
      !args.clientSecret
    ) {
      throw new GoogleOAuthError(
        "misconfigured",
        "Google OAuth client secret is required for this OAuth client. " +
          "Set GOOGLE_OAUTH_CLIENT_SECRET before connecting, or use a Desktop app OAuth client.",
      );
    }
    const detail = payload.error_description || payload.error || "Unknown token exchange error";
    throw new GoogleOAuthError("token_exchange_failed", `Google token exchange failed: ${detail}`);
  }

  const accessToken = payload.access_token ?? "";
  const refreshToken = payload.refresh_token || args.previousRefreshToken || "";
  if (!accessToken || !refreshToken) {
    throw new GoogleOAuthError(
      "token_exchange_failed",
      "Google token exchange did not return required tokens.",
    );
  }

  const grantedScope = payload.scope ?? OAUTH_SCOPES.join(" ");
  ensureRequiredGoogleFormsScope(grantedScope);
  const email = decodeEmailFromIdToken(payload.id_token);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: tokenExpiresAt(payload.expires_in),
    scope: grantedScope,
    token_type: payload.token_type,
    id_token: payload.id_token,
    email,
  };
}

async function refreshTokens(
  clientId: string,
  clientSecret: string,
  token: GoogleOAuthSettings,
): Promise<GoogleOAuthSettings> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const raw = await resp.text();
  const payload = parseTokenResponse(raw);

  if (!resp.ok) {
    if (payload.error === "invalid_grant") {
      clearGoogleOAuth();
      throw new GoogleOAuthError(
        "invalid_grant",
        "Google authorization was revoked or expired. Reconnect your Google account.",
      );
    }
    const detail = payload.error_description || payload.error || "Unknown refresh error";
    throw new GoogleOAuthError("oauth_failed", `Failed to refresh Google token: ${detail}`);
  }

  const accessToken = payload.access_token ?? "";
  if (!accessToken) {
    throw new GoogleOAuthError("oauth_failed", "Google refresh response did not include an access token.");
  }

  const email = decodeEmailFromIdToken(payload.id_token) || token.email || "";
  const nextScope = payload.scope ?? token.scope;
  ensureRequiredGoogleFormsScope(nextScope);
  const next: GoogleOAuthSettings = {
    access_token: accessToken,
    refresh_token: token.refresh_token,
    expires_at: tokenExpiresAt(payload.expires_in),
    scope: nextScope,
    token_type: payload.token_type ?? token.token_type,
    id_token: payload.id_token ?? token.id_token,
    email,
  };

  writeGoogleOAuth(next);
  return next;
}

function callbackHtml(title: string, message: string): string {
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\" />" +
    `<title>${title}</title>` +
    "</head><body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;\">" +
    `<h2 style=\"margin:0 0 8px 0;\">${title}</h2><p style=\"margin:0;\">${message}</p>` +
    "</body></html>"
  );
}

async function getAuthorizationCode(args: {
  clientId: string;
  state: string;
  codeVerifier: string;
}): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const clearActive = () => {
      if (activeConnectFlow?.cancel === cancelCurrentFlow) {
        activeConnectFlow = null;
      }
    };
    const fail = (error: GoogleOAuthError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearActive();
      server.close(() => undefined);
      reject(error);
    };
    const succeed = (value: { code: string; redirectUri: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearActive();
      server.close(() => undefined);
      resolve(value);
    };
    const cancelCurrentFlow = (message?: string) => {
      fail(
        new GoogleOAuthError(
          "user_cancelled",
          message || "Google authorization was canceled. You can connect again anytime.",
        ),
      );
    };
    activeConnectFlow = { cancel: cancelCurrentFlow };

    const server = createServer((req, res) => {
      const host = req.headers.host ?? "127.0.0.1";
      const callbackUrl = new URL(req.url ?? "/", `http://${host}`);
      if (callbackUrl.pathname !== "/oauth2/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const state = callbackUrl.searchParams.get("state") ?? "";
      const code = callbackUrl.searchParams.get("code") ?? "";
      const error = callbackUrl.searchParams.get("error") ?? "";

      if (error) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(callbackHtml("Google authorization canceled", "You can close this tab and return to the app."));
        fail(
          error === "access_denied"
            ? new GoogleOAuthError("user_cancelled", "Google authorization was canceled by the user.")
            : new GoogleOAuthError("oauth_failed", `Google authorization failed: ${error}`),
        );
        return;
      }

      if (!code || !state || state !== args.state) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(callbackHtml("Google authorization failed", "Invalid authorization response. You can close this tab."));
        fail(
          new GoogleOAuthError(
            "oauth_failed",
            "Google authorization failed due to an invalid callback state or missing code.",
          ),
        );
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(callbackHtml("Google connected", "Authorization complete. Return to the app."));

      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      if (!port) {
        fail(new GoogleOAuthError("oauth_failed", "Could not determine OAuth callback port."));
        return;
      }
      succeed({ code, redirectUri: `http://127.0.0.1:${port}/oauth2/callback` });
    });

    const timeout = setTimeout(() => {
      fail(new GoogleOAuthError("timeout", "Google authorization timed out. Try connecting again."));
    }, AUTH_TIMEOUT_MS);

    server.listen(0, "127.0.0.1", async () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      if (!port) {
        fail(new GoogleOAuthError("oauth_failed", "Could not start local OAuth callback server."));
        return;
      }

      const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
      const scope = OAUTH_SCOPES.join(" ");
      const challenge = buildPkceChallenge(args.codeVerifier);
      const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
      authUrl.searchParams.set("client_id", args.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scope);
      authUrl.searchParams.set("state", args.state);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      try {
        await shell.openExternal(authUrl.toString());
      } catch (error) {
        fail(
          new GoogleOAuthError(
            "oauth_failed",
            `Failed to open Google OAuth URL in browser: ${String(error)}`,
          ),
        );
      }
    });
  });
}

export function getGoogleAuthStatus(): GoogleAuthStatus {
  const token = readGoogleOAuth();
  if (!token) {
    return { connected: false, email: "" };
  }
  if (!hasRequiredGoogleFormsScope(token.scope)) {
    return { connected: false, email: "" };
  }
  return {
    connected: true,
    email: token.email ?? "",
  };
}

export async function connectGoogleAuth(): Promise<GoogleAuthStatus> {
  const { clientId, clientSecret } = ensureGoogleOAuthConfigured();
  if (activeConnectFlow) {
    throw new GoogleOAuthError(
      "connect_in_progress",
      "Google authorization is already in progress. Complete it or cancel and try again.",
    );
  }
  const state = base64UrlEncode(randomBytes(24));
  const codeVerifier = buildPkceVerifier();
  const existing = readGoogleOAuth();
  const auth = await getAuthorizationCode({ clientId, state, codeVerifier });
  const token = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code: auth.code,
    redirectUri: auth.redirectUri,
    codeVerifier,
    previousRefreshToken: existing?.refresh_token,
  });
  writeGoogleOAuth(token);
  return getGoogleAuthStatus();
}

export function cancelGoogleAuthConnect(): void {
  if (!activeConnectFlow) return;
  activeConnectFlow.cancel(
    "Google authorization was canceled. If needed, click Connect Google again.",
  );
}

export async function getGoogleAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const { clientId, clientSecret } = ensureGoogleOAuthConfigured();
  const token = readGoogleOAuth();
  if (!token) {
    throw new GoogleOAuthError(
      "not_connected",
      "Google account is not connected. Connect Google in Settings to continue.",
    );
  }
  if (!hasRequiredGoogleFormsScope(token.scope)) {
    clearGoogleOAuth();
    throw new GoogleOAuthError(
      "insufficient_scope",
      "Google OAuth token is missing Forms API scope. " +
        `Add "${REQUIRED_GOOGLE_FORMS_SCOPE}" in Google Cloud OAuth consent screen, ` +
        "then reconnect Google in Settings.",
    );
  }

  const forceRefresh = options?.forceRefresh ?? false;
  const needsRefresh = token.expires_at <= Date.now() + TOKEN_EXPIRY_SAFETY_WINDOW_MS;
  if (!forceRefresh && !needsRefresh) {
    return token.access_token;
  }

  const refreshed = await refreshTokens(clientId, clientSecret, token);
  return refreshed.access_token;
}

async function revokeToken(token: string): Promise<void> {
  if (!token.trim()) return;
  try {
    const body = new URLSearchParams({ token });
    await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    // Best effort.
  }
}

export async function disconnectGoogleAuth(): Promise<void> {
  const token = readGoogleOAuth();
  if (!token) return;
  await revokeToken(token.refresh_token || token.access_token);
  clearGoogleOAuth();
}
