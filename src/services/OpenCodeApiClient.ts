/**
 * HTTP API Client for OpenCode CLI communication
 *
 * Provides retry logic with exponential backoff for reliable communication
 * with the OpenCode CLI HTTP server.
 *
 * Contract notes (OpenCode >=1.x CLI):
 *   - Health endpoint is GET /global/health (NOT /health, which is the SPA
 *     index.html fallback). Response body: { healthy: boolean, version? }.
 *   - Append-prompt endpoint is POST /tui/append-prompt with body { text }.
 *     The instance-scoped routes (everything under WorkspaceRoutingMiddleware)
 *     require either ?directory=<path> or x-opencode-directory: <path> header
 *     to resolve the project instance.
 */

export interface HealthCheckResponse {
  healthy: boolean;
  version?: string;
}

export interface AppendPromptRequest {
  text: string;
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

  /**
   * Creates a new OpenCode API client
   * @param port - The port number the OpenCode CLI HTTP server is listening on
   * @param maxRetries - Maximum number of retry attempts (default: 10)
   * @param baseDelay - Base delay in milliseconds for exponential backoff (default: 200)
   * @param timeoutMs - Request timeout in milliseconds (default: 5000)
   * @param directory - Optional workspace directory sent via x-opencode-directory
   */
  constructor(
    port: number,
    maxRetries: number = 10,
    baseDelay: number = 200,
    timeoutMs: number = 5000,
    directory?: string,
  ) {
    this.baseUrl = `http://localhost:${port}`;
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.timeoutMs = timeoutMs;
    this.directory = directory;
  }

  /**
   * Performs a health check against the OpenCode CLI.
   * Uses the in-loop retry path (fetchWithRetry) and swallows network errors.
   * @returns Promise<boolean> - true if the server is healthy
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/global/health`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        this.maxRetries,
      );

      if (!response.ok) {
        return false;
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
   * - Server reachable and reports `healthy: true` → returns `true`
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
      const response = await fetch(`${this.baseUrl}/global/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        return false;
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
    const body: AppendPromptRequest = { text: prompt };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
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
