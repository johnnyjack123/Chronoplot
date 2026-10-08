import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  csrfTokenFor,
  resolveSession,
  safeEqual,
  type SessionUser,
} from "./session.js";
import { resolveApiToken } from "./tokens.js";
import { HttpError } from "../http-error.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated for every request that carries a valid session or API token. */
    user?: SessionUser;
    sessionToken?: string;
    /**
     * Set instead of `sessionToken` when the caller authenticated with an API
     * token. Carries the token's project scope, if it has one.
     */
    apiToken?: { tokenId: string; projectId: string | null };
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    // Follows APP_ORIGIN's scheme, not the build mode - see config.cookiesSecure
    // for the failure this caused.
    secure: config.cookiesSecure,
  };
}

export function setAuthCookies(reply: FastifyReply, token: string): void {
  const base = cookieOptions();
  const maxAge = Math.floor(config.sessionTtlMs / 1000);

  // The session cookie is httpOnly so script cannot read it.
  reply.setCookie(SESSION_COOKIE, token, { ...base, httpOnly: true, maxAge });
  // The CSRF cookie deliberately is not: the browser app reads it and echoes it
  // back in a header. Same-origin policy is what keeps other sites out.
  reply.setCookie(CSRF_COOKIE, csrfTokenFor(token), { ...base, httpOnly: false, maxAge });
}

export function clearAuthCookies(reply: FastifyReply): void {
  const base = cookieOptions();
  reply.clearCookie(SESSION_COOKIE, base);
  reply.clearCookie(CSRF_COOKIE, base);
}

export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("user", undefined);
  app.decorateRequest("sessionToken", undefined);
  app.decorateRequest("apiToken", undefined);

  app.addHook("onRequest", async (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      return;
    }

    const db = await getDb();
    const user = await resolveSession(db, token);
    if (user) {
      request.user = user;
      request.sessionToken = token;
    }
  });

  /*
   * API tokens, for clients that are not a browser.
   *
   * Deliberately sets `user` but never `sessionToken`. The CSRF hook below
   * keys off `sessionToken`, and setting it here would drag every token
   * request into a check that demands a cookie and a matching header no
   * plugin can produce - a 403 raised nowhere near its cause.
   *
   * Skipped entirely when a session cookie already authenticated the request,
   * so a browser cannot be talked into using a token it happens to have.
   */
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (request.user) {
      return;
    }

    const db = await getDb();
    const bearer = await resolveApiToken(db, request.headers.authorization);
    if (!bearer) {
      return;
    }

    request.user = {
      id: bearer.id,
      email: bearer.email,
      name: bearer.name,
      role: bearer.role,
    };
    request.apiToken = { tokenId: bearer.tokenId, projectId: bearer.projectId };
  });

  /*
   * CSRF defence, in two independent layers:
   *
   *   1. Origin check - a cross-site form post either omits Origin or sends a
   *      foreign one, and either way it does not match.
   *   2. Double-submit token - the header must match both the cookie and the
   *      value derived from the session, so a stale or guessed token fails.
   *
   * Requests without a session skip this: login and registration have nothing
   * to forge yet, and are covered by rate limiting instead.
   */
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (!MUTATING.has(request.method)) {
      return;
    }
    if (!request.sessionToken) {
      return;
    }

    const origin = request.headers.origin;
    if (origin && origin !== config.appOrigin) {
      throw new HttpError(403, "csrf_origin_mismatch", "Request origin is not allowed.");
    }

    const header = request.headers[CSRF_HEADER];
    const cookie = request.cookies[CSRF_COOKIE];
    const expected = csrfTokenFor(request.sessionToken);

    if (typeof header !== "string" || !cookie || !safeEqual(header, cookie) || !safeEqual(header, expected)) {
      throw new HttpError(403, "csrf_invalid", "Missing or invalid CSRF token.");
    }
  });
}

/** Throws 401 unless the request is authenticated, by cookie or by API token. */
export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) {
    throw new HttpError(401, "unauthenticated", "You must be signed in.");
  }
  return request.user;
}

/**
 * Throws unless a real browser session authenticated the request.
 *
 * Used for managing API tokens and passwords. If a token could mint tokens,
 * a leaked one would be an unrevokable foothold: revoke it and it has already
 * issued three more. Anything that changes how the account is accessed needs
 * the account, not one of its keys.
 */
export function requireSessionUser(request: FastifyRequest): SessionUser {
  const user = requireUser(request);
  if (!request.sessionToken) {
    throw new HttpError(
      403,
      "session_required",
      "This needs a signed-in browser session, not an API token.",
    );
  }
  return user;
}

/**
 * Enforces a token's project scope.
 *
 * A scoped token authenticates its owner but must not reach past the one
 * project it was issued for.
 */
export function assertTokenScope(request: FastifyRequest, projectId: string): void {
  const scope = request.apiToken?.projectId;
  if (scope && scope !== projectId) {
    throw new HttpError(403, "token_scope", "This token is scoped to a different project.");
  }
}
