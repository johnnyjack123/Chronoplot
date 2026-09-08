import { requestUrl } from "obsidian";
import type { OutgoingItem, ProjectSummary, SyncResponse } from "./types";

/*
 * The Chronoplot API client.
 *
 * Uses Obsidian's `requestUrl` rather than `fetch`. It runs outside the
 * renderer's CORS rules, so the server needs no CORS configuration at all -
 * which is the difference between this working against any instance and only
 * working against one that was set up to allow the plugin.
 */

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class ChronoplotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private get root(): string {
    // Tolerate a trailing slash and a pasted path; people paste what the
    // browser showed them.
    return this.baseUrl.trim().replace(/\/+$/, "");
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.root) throw new ApiError(0, "no_server", "No Chronoplot server address is set.");
    if (!this.token) throw new ApiError(0, "no_token", "No API token is set.");

    const response = await requestUrl({
      url: `${this.root}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Handled below rather than thrown, so an API error message survives.
      throw: false,
    });

    if (response.status >= 400) {
      const error = response.json?.error;
      throw new ApiError(
        response.status,
        error?.code ?? "unknown_error",
        error?.message ?? `The server returned ${response.status}.`,
      );
    }

    return response.json as T;
  }

  /** Confirms the token works, and says whose it is. */
  async whoami(): Promise<{ name: string; email: string }> {
    const result = await this.call<{ user: { name: string; email: string } | null }>(
      "GET",
      "/api/auth/me",
    );
    if (!result.user) {
      throw new ApiError(401, "unauthenticated", "The token was not accepted.");
    }
    return result.user;
  }

  async projects(): Promise<ProjectSummary[]> {
    const result = await this.call<{ projects: ProjectSummary[] }>("GET", "/api/projects");
    return result.projects;
  }

  async sync(
    projectId: string,
    vault: string,
    items: OutgoingItem[],
    dryRun: boolean,
  ): Promise<SyncResponse> {
    return this.call<SyncResponse>("POST", `/api/projects/${projectId}/sync`, {
      source: { kind: "obsidian", vault },
      dryRun,
      items,
    });
  }
}
