/**
 * Typed HTTP client for integration tests.
 *
 * Makes real HTTP calls to apps/server using the native `fetch` API.  The
 * client manages auth tokens internally so tests don't need to handle
 * headers manually for authenticated requests.
 *
 * ## Usage
 *
 * ```ts
 * const client = new TestClient("http://localhost:3001");
 *
 * // Login (stores token internally)
 * const loginRes = await client.login("admin@pharmacy.test", "AdminTest123!");
 *
 * // Authenticated request (token sent automatically)
 * const newUser = await client.createUser({ ... });
 *
 * // Verify as a different user
 * const cashierLogin = await client.login("cashier@pharmacy.test", "Cashier123!");
 * ```
 */
import { HttpError } from "@/infrastructure/http-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoginRequest {
  identifier: string;
  secret: string;
  sessionType: "PASSWORD" | "PIN";
  workstationId: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: {
    id: string;
    username: string | null;
    fullName: string;
    displayName: string | null;
    role: string;
    isActive: boolean;
    authMethod: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface CreateUserRequest {
  displayName: string;
  username?: string;
  email?: string;
  role: "MANAGER" | "CASHIER";
  initialPassword?: string;
  initialPin?: string;
}

export interface CreateUserResponse {
  id: string;
  displayName: string;
  username: string | null;
  role: string;
  initialPin: string | null;
  mustChangePassword: boolean;
}

export interface HealthResponse {
  /** True if the server returned any HTTP response. */
  reachable: boolean;
  /** HTTP status code received. */
  statusCode: number;
}

// ---------------------------------------------------------------------------
// TestClient
// ---------------------------------------------------------------------------

export class TestClient {
  private _accessToken: string | null = null;
  private _workstationId: string;

  constructor(
    readonly baseUrl: string,
    workstationId?: string,
  ) {
    this._workstationId = workstationId ?? "integration-test-ws-001";
  }

  /** The current access token (null if not logged in). */
  get accessToken(): string | null {
    return this._accessToken;
  }

  /** The workstation ID sent in request headers. */
  get workstationId(): string {
    return this._workstationId;
  }

  setWorkstationId(id: string): void {
    this._workstationId = id;
  }

  clearToken(): void {
    this._accessToken = null;
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { expectStatus?: number },
  ): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-workstation-id": this._workstationId,
    };

    if (this._accessToken) {
      headers.Authorization = `Bearer ${this._accessToken}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseBody = await response.text();
    let parsed: unknown;
    try {
      parsed = responseBody ? JSON.parse(responseBody) : null;
    } catch {
      parsed = responseBody;
    }

    if (!response.ok) {
      // If parseable JSON error, include errorCode and message
      const detail =
        typeof parsed === "object" && parsed !== null
          ? JSON.stringify(parsed)
          : responseBody;

      throw new RequestError(
        response.status,
        response.statusText,
        detail,
        path,
        method,
      );
    }

    if (options?.expectStatus !== undefined && response.status !== options.expectStatus) {
      throw new Error(
        `Expected status ${options.expectStatus} but got ${response.status} for ${method} ${path}`,
      );
    }

    return parsed as T;
  }

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  /**
   * Health check — verifies the server is reachable.
   *
   * Sends a GET to the root path.  Any response (even 404) confirms the
   * server is listening.
   */
  async health(): Promise<HealthResponse> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/`;
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return { reachable: true, statusCode: response.status };
    } catch {
      return { reachable: false, statusCode: 0 };
    }
  }

  /**
   * Log in with username/email and password.
   *
   * Stores the access token internally for subsequent authenticated requests.
   * Returns the full login response.
   */
  async login(
    identifier: string,
    secret: string,
    sessionType: "PASSWORD" | "PIN" = "PASSWORD",
  ): Promise<LoginResponse> {
    const body: LoginRequest = {
      identifier,
      secret,
      sessionType,
      workstationId: this._workstationId,
    };

    const response = await this.request<LoginResponse>("POST", "/auth/login", body);
    this._accessToken = response.accessToken;
    return response;
  }

  /**
   * Log out (revoke current session).
   */
  async logout(): Promise<void> {
    try {
      await this.request<unknown>("POST", "/auth/logout");
    } finally {
      this._accessToken = null;
    }
  }

  /**
   * Get current user info.
   */
  async me(): Promise<LoginResponse["user"]> {
    return this.request<LoginResponse["user"]>("GET", "/auth/me");
  }

  // -----------------------------------------------------------------------
  // Users
  // -----------------------------------------------------------------------

  /**
   * Create a new user (requires MANAGER or OWNER role).
   */
  async createUser(data: CreateUserRequest): Promise<CreateUserResponse> {
    return this.request<CreateUserResponse>("POST", "/users", data);
  }

  /**
   * List users (requires MANAGER or OWNER role).
   */
  async listUsers(params?: {
    role?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const query = new URLSearchParams();
    if (params?.role) query.set("role", params.role);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return this.request<Array<Record<string, unknown>>>("GET", `/users${qs ? `?${qs}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// RequestError
// ---------------------------------------------------------------------------

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly detail: string,
    readonly path: string,
    readonly method: string,
  ) {
    super(`HTTP ${status} ${statusText} — ${method} ${path}: ${detail}`);
    this.name = "RequestError";
  }
}
