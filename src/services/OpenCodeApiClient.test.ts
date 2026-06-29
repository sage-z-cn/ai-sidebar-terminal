import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OpenCodeApiClient,
  type HealthCheckResponse,
} from "./OpenCodeApiClient";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OpenCodeApiClient", () => {
  let client: OpenCodeApiClient;
  const TEST_PORT = 8080;
  const BASE_URL = `http://localhost:${TEST_PORT}`;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OpenCodeApiClient(TEST_PORT);
  });

  describe("constructor", () => {
    it("should create client with default retry settings", () => {
      const defaultClient = new OpenCodeApiClient(TEST_PORT);
      expect(defaultClient).toBeDefined();
    });

    it("should create client with custom retry settings", () => {
      const customClient = new OpenCodeApiClient(TEST_PORT, 5, 100);
      expect(customClient).toBeDefined();
    });

    it("should accept different port numbers", () => {
      const port3000 = new OpenCodeApiClient(3000);
      const port9000 = new OpenCodeApiClient(9000);
      expect(port3000).toBeDefined();
      expect(port9000).toBeDefined();
    });
  });

  describe("healthCheck", () => {
    it("should return true when server responds with healthy body", async () => {
      const mockResponse: HealthCheckResponse = {
        healthy: true,
        version: "1.17.11",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/global/health`,
        expect.objectContaining({
          method: "GET",
          headers: { Accept: "application/json" },
        }),
      );
    });

    it("should return false when server responds with error status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it("should return false when response status is not ok", async () => {
      const mockResponse: HealthCheckResponse = {
        healthy: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it("should return false when fetch throws error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it("should retry on connection errors and eventually succeed", async () => {
      const mockResponse: HealthCheckResponse = {
        healthy: true,
      };

      mockFetch
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should return false after exhausting all retries", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 3, 10);
      const result = await shortClient.healthCheck();

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    });
  });

  describe("healthCheckOnce", () => {
    it("should return true when server responds with healthy body", async () => {
      const mockResponse: HealthCheckResponse = {
        healthy: true,
        version: "1.17.11",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.healthCheckOnce();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/global/health`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should return false when server responds with non-ok HTTP", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await client.healthCheckOnce();

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return false when response body reports unhealthy", async () => {
      const mockResponse: HealthCheckResponse = { healthy: false };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.healthCheckOnce();

      expect(result).toBe(false);
    });

    it("should throw when fetch fails with a network error (no retry)", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      await expect(client.healthCheckOnce()).rejects.toThrow(
        "Connection refused",
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should NOT retry on network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      await expect(client.healthCheckOnce()).rejects.toThrow(
        "Connection refused",
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("appendPrompt", () => {
    it("should successfully append prompt", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await client.appendPrompt("Hello, OpenCode!");

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/tui/append-prompt`,
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ text: "Hello, OpenCode!" }),
        }),
      );
    });

    it("should handle prompts with special characters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const specialPrompt = "Hello! @file#L10-20 #tag $var `code`";
      await client.appendPrompt(specialPrompt);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ text: specialPrompt }),
        }),
      );
    });

    it("should handle multiline prompts", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const multilinePrompt = "Line 1\nLine 2\nLine 3";
      await client.appendPrompt(multilinePrompt);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ text: multilinePrompt }),
        }),
      );
    });

    it("should send x-opencode-directory header when directory is configured", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const dir = "/home/user/project";
      const dirClient = new OpenCodeApiClient(
        TEST_PORT,
        10,
        200,
        5000,
        dir,
      );

      await dirClient.appendPrompt("hi");

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/tui/append-prompt`,
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-opencode-directory": dir,
          }),
        }),
      );
    });

    it("should omit x-opencode-directory header when directory is not set", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.appendPrompt("hi");

      const callArgs = mockFetch.mock.calls[0]?.[1] as
        | { headers?: Record<string, string> }
        | undefined;
      expect(callArgs?.headers).toBeDefined();
      expect(callArgs?.headers).not.toHaveProperty("x-opencode-directory");
    });

    it("should throw error when server responds with error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.appendPrompt("test")).rejects.toThrow(
        "Failed to append prompt: 500 Internal Server Error",
      );
    });

    it("should throw error with status code on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      try {
        await client.appendPrompt("test");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as Error & {
          statusCode?: number;
          code?: string;
        };
        expect(apiError.statusCode).toBe(404);
      }
    });

    it("should retry on connection errors and eventually succeed", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce({
          ok: true,
        });

      await client.appendPrompt("test prompt");

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should throw error after exhausting all retries", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 2, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "Request failed after 2 retries",
      );
    });

    it("should include error code on max retries exhausted", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 1, 10);

      try {
        await shortClient.appendPrompt("test");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as Error & {
          statusCode?: number;
          code?: string;
        };
        expect(apiError.code).toBe("MAX_RETRIES_EXHAUSTED");
      }
    });

    it("should throw timeout exhaustion errors with a timeout code", async () => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      const shortClient = new OpenCodeApiClient(TEST_PORT, 0, 10, 25);

      try {
        await shortClient.appendPrompt("test");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as Error & { code?: string };
        expect(apiError.message).toBe(
          "Request timed out after 25ms (exhausted all 0 retries)",
        );
        expect(apiError.code).toBe("TIMEOUT_EXHAUSTED");
      }
    });

    it("should retry abort errors when retries remain", async () => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError).mockResolvedValueOnce({
        ok: true,
      });

      const shortClient = new OpenCodeApiClient(TEST_PORT, 1, 1, 25);

      await expect(shortClient.appendPrompt("test")).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should stringify non-Error failures after retries are exhausted", async () => {
      mockFetch.mockRejectedValue("network down");

      const shortClient = new OpenCodeApiClient(TEST_PORT, 0, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "Request failed after 0 retries: network down",
      );
    });
  });

  describe("retry logic", () => {
    it("should use exponential backoff between retries", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 3, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "Request failed after 3 retries",
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("should not retry on successful response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await client.appendPrompt("test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("should handle network timeouts gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 1, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "ETIMEDOUT",
      );
    });

    it("should handle DNS resolution errors gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("ENOTFOUND"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 1, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "ENOTFOUND",
      );
    });

    it("should handle empty prompt gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(client.appendPrompt("")).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ text: "" }),
        }),
      );
    });
  });

});
