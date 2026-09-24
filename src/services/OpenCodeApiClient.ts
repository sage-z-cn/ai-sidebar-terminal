/**
 * HTTP API Client for OpenCode CLI communication
 *
 * Provides retry logic with exponential backoff for reliable communication
 * with the OpenCode CLI HTTP server.
 *
 * Contract notes:
 *   OpenCode v1 (TUI-hosted HTTP server, launched with `--port=N`):
 *     - Health endpoint is GET /global/health (NOT /health, which is the SPA
 *       index.html fallback). Response body: { healthy: boolean, version? }.
 *     - Append-prompt endpoint is POST /tui/append-prompt with body { text }.
 *       Instance-scoped routes (WorkspaceRoutingMiddleware) require either
 *       ?directory=<path> or x-opencode-directory: <path> header.
 *
 *   OpenCode v2 (background service, TUI rejects `--port`):
 *     - Endpoint discovered from service state / `opencode service status`.
 *     - Auth: HTTP Basic username `opencode` + service password.
 *     - Health endpoint is GET /api/info (ServerInfo). HTTP 200 = healthy.
 *     - There is no TUI append-prompt route. `appendPrompt` throws so callers
 *       fall back to terminal input, which is the correct way to fill the v2
 *       TUI composer.
 */

import {
  buildOpenCodeV2AuthHeader,
  type OpenCodeApiProtocol,
  type OpenCodeV2ServiceInfo,
} from "./OpenCodeCliCompat";

export interface HealthCheckResponse {
  healthy: boolean;
  version?: string;
}

export interface AppendPromptRequest {
  text: string;
}

export interface OpenCodeApiClientOptions {
  /** API contract to speak. Defaults to v1 for backward compatibility. */
  apiProtocol?: OpenCodeApiProtocol;
  /** Full base URL override (used by v2 background service). */
  baseUrl?: string;
  /** v2 service password for HTTP Basic auth. */
  password?: string;
}

interface ApiError extends Error {
  code?: string;
  statusCode?: number;
}

export class OpenCodeApiClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly timeoutMs: number;
  /**
   * Workspace directory sent via the `x-opencode-directory` header on
   * instance-scoped routes. Optional: when omitted the server falls back to
   * its own process.cwd(); always supply this for reliability.
   */
  private readonly directory?: string;
  private readonly apiProtocol: OpenCodeApiProtocol;
  private readonly password?: string;

  /**
   * Creates a new OpenCode API client
   * @param port - The port number the OpenCode CLI HTTP server is listening on
   * @param maxRetries - Maximum number of retry attempts (default: 10)
   * @param baseDelay - Base delay in milliseconds for exponential backoff (default: 200)
   * @param timeoutMs - Request timeout in milliseconds (default: 5000)
   * @param directory - Optional workspace directory sent via x-opencode-directory
   * @param options - Optional v1/v2 protocol, baseUrl, and v2 password
   */
  constructor(
    port: number,
    maxRetries: number = 10,
    baseDelay: number = 200,
    timeoutMs: number = 5000,
    directory?: string,
    options?: OpenCodeApiClientOptions,
  ) {
    this.baseUrl = (options?.baseUrl ?? `http://localhost:${port}`).replace(
      /\/$/,
      "",
    );
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.timeoutMs = timeoutMs;
    this.directory = directory;
    this.apiProtocol = options?.apiProtocol ?? "v1";
    this.password = options?.password;
  }

  /** Builds a client for an OpenCode v2 background-service endpoint. */
  public static fromV2Service(
    service: OpenCodeV2ServiceInfo,
    init?: {
      maxRetries?: number;
      baseDelay?: number;
      timeoutMs?: number;
      directory?: string;
    },
  ): OpenCodeApiClient {
    return new OpenCodeApiClient(
      service.port,
      init?.maxRetries ?? 10,
      init?.baseDelay ?? 200,
      init?.timeoutMs ?? 5000,
      init?.directory,
      {
        apiProtocol: "v2",
        baseUrl: service.url,
        password: service.password,
      },
    );
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...extra,
    };
    if (this.apiProtocol === "v2" && this.password) {
      headers.Authorization = buildOpenCodeV2AuthHeader(this.password);
    }
    return headers;
  }

  private healthUrl(): string {
    return this.apiProtocol === "v2"
      ? `${this.baseUrl}/api/info`
      : `${this.baseUrl}/global/health`;
  }

  /**
   * Performs a health check against the OpenCode CLI.
   * Uses the in-loop retry path (fetchWithRetry) and swallows network errors.
   * @returns Promise<boolean> - true if the server is healthy
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry(
        this.healthUrl(),
        {
          method: "GET",
          headers: this.buildHeaders(),
        },
        this.maxRetries,
      );

      if (!response.ok) {
        return false;
      }

      if (this.apiProtocol === "v2") {
        // ServerInfo is returned; a 200 means the service is up.
        return true;
      }

      const data = (await response.json()) as HealthCheckResponse;
      return data.healthy === true;
    } catch {
      return false;
    }
  }

  /**
   * Performs a single health check attempt with NO internal retry.
   *
   * Use this (not {@link healthCheck}) inside outer retry loops such as
   * {@link SessionRuntime.pollForHttpReadiness} to avoid the double-retry
   * amplification where one outer attempt silently waits through maxRetries
   * exponential backoff inside healthCheck while logging nothing.
   *
   * - Server reachable and healthy → returns `true`
   * - Server reachable but unhealthy (non-ok HTTP or unhealthy body) → returns `false`
   * - Network failure (connection refused, timeout, abort) → throws Error
   *
   * @returns Promise<boolean> - true if the server is healthy
   * @throws Error when the request cannot reach the server
   */
  public async healthCheckOnce(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.healthUrl(), {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        return false;
      }

      if (this.apiProtocol === "v2") {
        return true;
      }

      const data = (await response.json()) as HealthCheckResponse;
      return data.healthy === true;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Appends a prompt to the Open Sidebar Terminal
   * @param prompt - The prompt text to append
   * @returns Promise<void>
   * @throws ApiError if the request fails after all retries
   */
  public async appendPrompt(prompt: string): Promise<void> {
    if (this.apiProtocol === "v2") {
      // v2 removed the TUI append-prompt HTTP route. Callers already fall
      // back to writing into the terminal, which fills the v2 TUI composer.
      const error = new Error(
        "OpenCode v2 does not expose TUI append-prompt; use terminal input fallback",
      ) as ApiError;
      error.code = "V2_APPEND_PROMPT_UNSUPPORTED";
      error.statusCode = 501;
      throw error;
    }

    const body: AppendPromptRequest = { text: prompt };
    const headers = this.buildHeaders({
      "Content-Type": "application/json",
    });
    if (this.directory) {
      headers["x-opencode-directory"] = this.directory;
    }

    const response = await this.fetchWithRetry(
      `${this.baseUrl}/tui/append-prompt`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      this.maxRetries,
    );

    if (!response.ok) {
      const error = new Error(
        `Failed to append prompt: ${response.status} ${response.statusText}`,
      ) as ApiError;
      error.statusCode = response.status;
      throw error;
    }
  }

  /**
   * Fetch with retry logic using exponential backoff
   * @param url - The URL to fetch
   * @param options - Fetch options
   * @param retries - Number of retry attempts remaining
   * @returns Promise<Response>
   * @throws ApiError if all retries are exhausted
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number,
  ): Promise<Response> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (retries <= 0) {
          const apiError = new Error(
            `Request timed out after ${this.timeoutMs}ms (exhausted all ${this.maxRetries} retries)`,
          ) as ApiError;
          apiError.code = "TIMEOUT_EXHAUSTED";
          throw apiError;
        }
      } else if (retries <= 0) {
        const apiError = new Error(
          `Request failed after ${this.maxRetries} retries: ${error instanceof Error ? error.message : String(error)}`,
        ) as ApiError;
        apiError.code = "MAX_RETRIES_EXHAUSTED";
        throw apiError;
      }

      const attemptNumber = this.maxRetries - retries + 1;
      const delay = this.baseDelay * Math.pow(2, attemptNumber - 1);

      await this.sleep(delay);

      return this.fetchWithRetry(url, options, retries - 1);
    }
  }

  /**
   * Sleep for a specified number of milliseconds
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
