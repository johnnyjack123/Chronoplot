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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  role: "admin" | "user";
}

/** A token as it can be listed. The secret itself is never part of this. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  projectId: string | null;
  projectTitle: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  createdAt: number;
  projectCount: number;
}

export const api = {
  session: () =>
    request<{ user: SessionUser | null; allowRegistration: boolean; needsSetup: boolean }>(
      "/api/auth/me",
    ),

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

  updateProfile: (name: string) =>
    request<{ user: SessionUser }>("/api/auth/profile", { method: "PATCH", body: { name } }),

  /* --------------------------------------------------------- api tokens -- */

  listTokens: () => request<{ tokens: ApiTokenSummary[] }>("/api/tokens"),

  /** The only call that ever returns the secret. It cannot be read back. */
  createToken: (name: string, projectId: string | null, expiresInDays: number | null) =>
    request<{ id: string; token: string }>("/api/tokens", {
      method: "POST",
      body: { name, projectId, expiresInDays },
    }),

  revokeToken: (id: string) => request<{ ok: true }>(`/api/tokens/${id}`, { method: "DELETE" }),

  /* -------------------------------------------------------------- admin -- */

  adminSettings: () => request<{ allowRegistration: boolean }>("/api/admin/settings"),

  setAdminSettings: (allowRegistration: boolean) =>
    request<{ allowRegistration: boolean }>("/api/admin/settings", {
      method: "PUT",
      body: { allowRegistration },
    }),

  adminUsers: () => request<{ users: AdminUser[] }>("/api/admin/users"),

  adminCreateUser: (input: { name: string; email: string; password: string; role: "admin" | "user" }) =>
    request<{ user: AdminUser }>("/api/admin/users", { method: "POST", body: input }),

  adminResetPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/api/admin/users/${id}/password`, { method: "POST", body: { password } }),

  adminSetRole: (id: string, role: "admin" | "user") =>
    request<{ ok: true }>(`/api/admin/users/${id}`, { method: "PATCH", body: { role } }),

  adminDeleteUser: (id: string) =>
    request<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE" }),

  /* ------------------------------------------------------------- import -- */

  importProject: (title: string, doc: TimelineDoc) =>
    request<{ project: ProjectSummary }>("/api/projects/import", {
      method: "POST",
      body: { title, doc },
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
