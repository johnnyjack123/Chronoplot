/*
 * The only place that talks to the server.
 *
 * Every mutating call echoes the CSRF cookie back in a header - that echo is
 * what the server checks, and doing it here means no caller can forget.
 */
import type { ProjectDetail, ProjectSummary, TimelineDoc } from "@shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when the session expired or was never established. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** True when someone else saved the project first. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Lets a request survive a page unload, used by the final sync flush. */
  keepalive?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const csrf = readCookie("cp_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      keepalive: options.keepalive,
      signal: options.signal,
    });
  } catch (cause) {
    // A network failure is not a server error; the sync engine retries these
    // rather than surfacing them as a lost edit.
    throw new ApiError(0, "network_error", "Cannot reach the server.", cause);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(response.status, "malformed_response", "The server sent an unreadable response.");
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "unknown_error",
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details,
    );
  }

  return payload as T;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export const api = {
  session: () =>
    request<{ user: SessionUser | null; allowRegistration: boolean }>("/api/auth/me"),

  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("/api/auth/login", { method: "POST", body: { email, password } }),

  register: (name: string, email: string, password: string) =>
    request<{ user: SessionUser }>("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  changePassword: (currentPassword: string, password: string) =>
    request<{ ok: true }>("/api/auth/password", {
      method: "POST",
      body: { currentPassword, password },
    }),

  listProjects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),

  createProject: (title: string) =>
    request<{ project: ProjectSummary }>("/api/projects", { method: "POST", body: { title } }),

  getProject: (id: string) => request<{ project: ProjectDetail }>(`/api/projects/${id}`),

  saveProject: (
    id: string,
    payload: { title: string; doc: TimelineDoc; baseVersion: number },
    options: { keepalive?: boolean; signal?: AbortSignal } = {},
  ) =>
    request<{ version: number; updatedAt: number }>(`/api/projects/${id}`, {
      method: "PUT",
      body: payload,
      ...options,
    }),

  deleteProject: (id: string) =>
    request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),

  listMembers: (id: string) =>
    request<{
      members: { id: string; name: string; email: string; role: "owner" | "editor" | "viewer" }[];
      canManage: boolean;
    }>(`/api/projects/${id}/members`),

  addMember: (id: string, email: string, role: "editor" | "viewer") =>
    request<{ ok: true }>(`/api/projects/${id}/members`, { method: "POST", body: { email, role } }),

  removeMember: (id: string, userId: string) =>
    request<{ ok: true }>(`/api/projects/${id}/members/${userId}`, { method: "DELETE" }),
};
