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
import { HttpError } from "../http-error.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated for every request that carries a valid session cookie. */
    user?: SessionUser;
    sessionToken?: string;
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: config.isProduction,
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

  app.addHook("onRequest", async (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;

    const db = await getDb();
    const user = await resolveSession(db, token);
    if (user) {
      request.user = user;
      request.sessionToken = token;
    }
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
    if (!MUTATING.has(request.method)) return;
    if (!request.sessionToken) return;

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

/** Throws 401 unless the request carries a valid session. */
export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) {
    throw new HttpError(401, "unauthenticated", "You must be signed in.");
  }
  return request.user;
}
