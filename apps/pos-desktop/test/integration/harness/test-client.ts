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
  locationIds?: string[];
}

export interface CreateUserResponse {
  id: string;
  displayName: string;
  username: string | null;
  role: string;
  initialPin: string | null;
  mustChangePassword: boolean;
}

// ---------------------------------------------------------------------------
// Sale / Cash-shift types
// ---------------------------------------------------------------------------

export interface OpenShiftRequest {
  openingBalance: string;
  openingNotes?: string;
}

export interface OpenShiftResponse {
  id: string;
  state: string;
  openingBalance: string;
  workstationId: string;
  openedAt: string;
}

export interface CreateSaleRequest {
  saleType: "FREE_SALE" | "PRESCRIPTION" | "CONTROLLED_SUBSTANCE";
  cashShiftId: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
  }>;
  clientId?: string | null;
}

export interface CreateSaleResponse {
  id: string;
  operationalState: string;
  cashShiftId: string;
  totalAmount: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
  }>;
}

export interface ConfirmSaleRequest {
  payments: Array<{
    paymentMethodId: string;
    amount: number;
  }>;
}

export interface ConfirmSaleResponse {
  id: string;
  operationalState: string;
  confirmedAt: string;
  payments: Array<{
    paymentMethodId: string;
    amount: number;
  }>;
}

export interface RegisterCashCountRequest {
  countType: "PARTIAL" | "CLOSING";
  paymentMethodId: string;
  expectedAmount: string;
  declaredAmount: string;
}

export interface CloseShiftRequest {
  closingNotes?: string;
}

export interface AnnulSaleRequest {
  annulmentReason: string;
  annulmentNotes?: string;
}

// ---------------------------------------------------------------------------
// Catalog / Product types
// ---------------------------------------------------------------------------

export interface CreateProductRequest {
  internalCode: string;
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  laboratory: string;
  saleType: "FREE_SALE" | "PRESCRIPTION" | "CONTROLLED_SUBSTANCE";
  initialPrice: string;
  initialTaxSchemeId: string;
  concentration?: string;
  concentrationUnit?: string;
  minimumStock?: number;
  invimaRegistry?: string;
  atcCode?: string;
  categoryId?: string;
  pharmaceuticalFormId?: string;
}

export interface RegisterPriceRequest {
  price: string;
  effectiveFrom?: string;
  changeReason?: string;
}

export interface AssignTaxSchemeRequest {
  taxSchemeId: string;
  effectiveFrom?: string;
  changeReason?: string;
}

export interface AddBarcodeRequest {
  barcode: string;
  barcodeType: "EAN13" | "EAN14" | "GTIN" | "INTERNAL" | "DATAMATRIX";
  isPrimary?: boolean;
}

export interface BlockLotRequest {
  reason: string;
}

// ---------------------------------------------------------------------------
// Sync types
// ---------------------------------------------------------------------------

export interface SyncOperation {
  operationType:
    | "SALE_CONFIRMATION"
    | "SHIFT_CLOSURE"
    | "CLIENT_CREATION"
    | "CLIENT_RETURN"
    | "INVENTORY_ADJUSTMENT"
    | "FISCAL_DOCUMENT_SYNC"
    | "PRESCRIPTION_REGISTRATION"
    | "RESOLUTION_ALLOCATION"
    | "INVOICE_TRANSMISSION";
  operationUuid: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  sourceCreatedAt: string;
  clientSequence: number;
}

export interface SyncBatchRequest {
  operations: SyncOperation[];
}

export interface SyncBatchResponse {
  operationUuid: string;
  status: "ACCEPTED" | "ALREADY_ACCEPTED" | "REJECTED";
  error?: string;
}

export interface SyncStatusResponse {
  sourceWorkstationId: string;
  pending: number;
  failed: number;
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
   * Refresh the current session (exchange access token for new tokens).
   * Updates the internal access token on success.
   */
  async refreshSession(): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }> {
    const response = await this.request<{
      accessToken: string;
      refreshToken: string;
      expiresAt: string;
    }>("POST", "/auth/refresh");
    this._accessToken = response.accessToken;
    return response;
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
   * Update a user (requires MANAGER or OWNER role).
   * Accepts partial fields: displayName, role, isActive, locationIds.
   */
  async updateUser(
    userId: string,
    data: {
      displayName?: string;
      role?: "MANAGER" | "CASHIER";
      isActive?: boolean;
      locationIds?: string[];
    },
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("PATCH", `/users/${userId}`, data);
  }

  /**
   * Disable a user (requires MANAGER or OWNER role).
   */
  async disableUser(userId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("POST", `/users/${userId}/disable`);
  }

  /**
   * Enable a disabled user (requires MANAGER or OWNER role).
   */
  async enableUser(userId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("POST", `/users/${userId}/enable`);
  }

  /**
   * Unlock a locked user account (requires MANAGER or OWNER role).
   */
  async unlockUser(userId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("POST", `/users/${userId}/unlock`);
  }

  /**
   * Reset a user's PIN (requires MANAGER or OWNER role).
   * Returns the new PIN.
   */
  async resetUserPin(userId: string): Promise<{ newPin: string; message: string }> {
    return this.request<{ newPin: string; message: string }>("POST", `/users/${userId}/reset-pin`);
  }

  // -----------------------------------------------------------------------
  // Sessions
  // -----------------------------------------------------------------------

  /**
   * List the current user's active sessions.
   */
  async listMySessions(): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>("GET", "/auth/sessions");
  }

  /**
   * Revoke one of the current user's sessions.
   */
  async revokeMySession(sessionId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("POST", `/auth/sessions/${sessionId}/revoke`);
  }

  /**
   * Get a user by ID (requires MANAGER or OWNER role).
   * Includes locationAccess in the response.
   */
  async getUser(userId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/users/${userId}`);
  }

  /**
   * List users (requires MANAGER or OWNER role).
   *
   * Server returns `{ users: [...], total: number }` — the POS desktop
   * calls this via `authService.listUsers()` and expects paginated format.
   */
  async listUsers(params?: {
    role?: string;
    status?: string;
    locationId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ users: Array<Record<string, unknown>>; total: number }> {
    const query = new URLSearchParams();
    if (params?.role) query.set("role", params.role);
    if (params?.status) query.set("status", params.status);
    if (params?.locationId) query.set("locationId", params.locationId);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return this.request<{ users: Array<Record<string, unknown>>; total: number }>(
      "GET",
      `/users${qs ? `?${qs}` : ""}`,
    );
  }

  // -----------------------------------------------------------------------
  // Cash shifts
  // -----------------------------------------------------------------------

  /**
   * Open a cash shift (requires CASHIER or ADMIN role).
   */
  async openShift(data: OpenShiftRequest): Promise<OpenShiftResponse> {
    return this.request<OpenShiftResponse>("POST", "/cash-shifts", data);
  }

  /**
   * Register a cash count for a shift (requires CASHIER or ADMIN role).
   */
  async registerCashCount(
    shiftId: string,
    data: RegisterCashCountRequest,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/cash-shifts/${shiftId}/cash-counts`, data);
  }

  /**
   * Close a cash shift (requires CASHIER or ADMIN role).
   */
  async closeShift(shiftId: string, data: CloseShiftRequest): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/cash-shifts/${shiftId}/close`, data);
  }

  // -----------------------------------------------------------------------
  // Sales
  // -----------------------------------------------------------------------

  /**
   * Create a sale (requires CASHIER or ADMIN role).
   */
  async createSale(data: CreateSaleRequest): Promise<CreateSaleResponse> {
    return this.request<CreateSaleResponse>("POST", "/sales-pos", data);
  }

  /**
   * Confirm a sale (requires CASHIER or ADMIN role).
   */
  async confirmSale(saleId: string, data: ConfirmSaleRequest): Promise<ConfirmSaleResponse> {
    return this.request<ConfirmSaleResponse>("POST", `/sales-pos/${saleId}/confirm`, data);
  }

  /**
   * Annul a sale (requires ADMIN role).
   */
  async annulSale(saleId: string, data: AnnulSaleRequest): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/sales-pos/${saleId}/annul`, data);
  }

  // -----------------------------------------------------------------------
  // Catalog / Products
  // -----------------------------------------------------------------------

  /**
   * Create a product (requires INVENTORY_ASSISTANT or ADMIN role).
   */
  async createProduct(data: CreateProductRequest): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/products", data);
  }

  /**
   * Get a product by ID (requires INVENTORY_ASSISTANT or ADMIN role).
   */
  async getProduct(productId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/products/${productId}`);
  }

  /**
   * Register a price for a product (requires ADMIN role).
   */
  async registerProductPrice(
    productId: string,
    data: RegisterPriceRequest,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/products/${productId}/price`, data);
  }

  /**
   * Assign a tax scheme to a product (requires ADMIN role).
   */
  async assignProductTaxScheme(
    productId: string,
    data: AssignTaxSchemeRequest,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/products/${productId}/tax-scheme`, data);
  }

  /**
   * Add a barcode to a product (requires INVENTORY_ASSISTANT or ADMIN role).
   */
  async addProductBarcode(
    productId: string,
    data: AddBarcodeRequest,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/products/${productId}/barcodes`, data);
  }

  // -----------------------------------------------------------------------
  // Inventory / Lots
  // -----------------------------------------------------------------------

  /**
   * Get a lot by ID (requires CASHIER, INVENTORY_ASSISTANT, or ADMIN role).
   */
  async getLot(lotId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/inventory-lots/lots/${lotId}`);
  }

  /**
   * Block a lot (requires ADMIN role).
   */
  async blockLot(lotId: string, data: BlockLotRequest): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/inventory-lots/lots/${lotId}/block`, data);
  }

  /**
   * Unblock a lot (requires ADMIN role).
   */
  async unblockLot(lotId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/inventory-lots/lots/${lotId}/unblock`);
  }

  // -----------------------------------------------------------------------
  // Sync
  // -----------------------------------------------------------------------

  /**
   * Send a batch of offline operations for sync processing.
   * Requires JWT auth (any authenticated user).
   * Returns HTTP 202 with per-operation ACCEPTED/REJECTED status.
   */
  async sendSyncBatch(data: SyncBatchRequest): Promise<SyncBatchResponse[]> {
    return this.request<SyncBatchResponse[]>("POST", "/sync/batch", data);
  }

  /**
   * Get the sync queue status for the current workstation.
   * Requires JWT auth.
   */
  async getSyncStatus(): Promise<SyncStatusResponse> {
    return this.request<SyncStatusResponse>("GET", "/sync/status");
  }

  /**
   * List sync queue entries (requires ADMIN role).
   * Returns paginated: { data, total, page, pageSize }.
   */
  async listSyncQueue(params?: {
    status?: string;
    operationType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.operationType) query.set("operationType", params.operationType);
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    if (!query.has("page")) query.set("page", "1");
    if (!query.has("pageSize")) query.set("pageSize", "50");
    const qs = query.toString();
    return this.request<Record<string, unknown>>("GET", `/sync/queue${qs ? `?${qs}` : ""}`);
  }

  /**
   * Retry a failed sync queue entry (requires ADMIN role).
   * Resets status from FAILED back to PENDING.
   */
  async retrySyncEntry(entryId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/sync/queue/${entryId}/retry`);
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
