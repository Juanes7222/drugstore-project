// jest.mock factories are used instead of jest.unstable_mockModule: the
// latter does not register in this Jest/ts-jest ESM setup.
jest.mock("./auth.service", () => ({ AuthService: class {} }));
jest.mock("./services/firebase-auth.service", () => ({
  FirebaseAuthService: class {},
}));
jest.mock("./services/session.service", () => ({ SessionService: class {} }));
jest.mock("@/common/guards/jwt-auth.guard", () => ({
  JwtAuthGuard: class {},
}));
jest.mock("@/common/guards/roles.guard", () => ({ RolesGuard: class {} }));
jest.mock("./guards/jwt-refresh.guard", () => ({ JwtRefreshGuard: class {} }));
import { createPrismaDatabaseMock } from "../../../test/helpers/prisma-database-mock";

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock("@pharmacy/database", () => createPrismaDatabaseMock());

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { FirebaseAuthService } from "./services/firebase-auth.service";
import { SessionService } from "./services/session.service";
import { JwtRefreshGuard } from "./guards/jwt-refresh.guard";
import { InvalidVerificationTokenException } from "./exceptions/invalid-verification-token.exception";

function buildAuthResponseData(): any {
  return {
    accessToken: "at-123",
    refreshToken: "rt-123",
    expiresAt: new Date(0),
    user: {
      id: "resp-user",
      role: "OWNER",
      authMethod: "OAUTH_GOOGLE",
      email: "e@e.com",
      isActive: true,
    },
    sessionId: "sess-1",
    offlineToken: { token: "ot-1", expiresAt: new Date(0) },
    credentialVerificationKey: {
      encryptedBlob: "b",
      keyFingerprint: "fp",
      version: 1,
    },
  };
}

describe("AuthController", () => {
  let app: INestApplication;
  let authServiceMock: {
    loginWithFirebase: jest.Mock;
    refreshSession: jest.Mock;
    bootstrapSaasAdmin: jest.Mock;
    verifyEmail: jest.Mock;
    requestEmailVerification: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
  };
  let firebaseAuthMock: { isConfigured: boolean; verifyIdToken: jest.Mock };
  let configServiceMock: { get: jest.Mock };
  let jwtServiceMock: { sign: jest.Mock; decode: jest.Mock };

  beforeEach(async () => {
    authServiceMock = {
      loginWithFirebase: jest.fn(),
      refreshSession: jest.fn(),
      bootstrapSaasAdmin: jest.fn(),
      verifyEmail: jest.fn(),
      requestEmailVerification: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
    };
    firebaseAuthMock = {
      isConfigured: true,
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: "u1",
        email: "e@e.com",
        displayName: "DN",
        photoURL: "pu",
        emailVerified: true,
      }),
    };
    configServiceMock = { get: jest.fn() };
    jwtServiceMock = { sign: jest.fn(), decode: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      // The verify-email / resend-verification / forgot-password /
      // reset-password endpoints bind ThrottlerGuard at method level, whose
      // storage and options providers live in AppModule. overrideGuard alone
      // cannot satisfy compile-time DI, so the module is imported for them and
      // the guard itself is stubbed below (its limits would otherwise need a
      // real Redis connection).
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: "default", ttl: 60000, limit: 1000 }],
        }),
      ],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: FirebaseAuthService, useValue: firebaseAuthMock },
        { provide: SessionService, useValue: {} },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /auth/firebase/config", () => {
    it("returns the env-derived public config", async () => {
      configServiceMock.get.mockImplementation(
        (k: string) =>
          ({
            FIREBASE_API_KEY: "ak",
            FIREBASE_AUTH_DOMAIN: "ad",
            FIREBASE_PROJECT_ID: "pid",
            FIREBASE_STORAGE_BUCKET: "sb",
            FIREBASE_MESSAGING_SENDER_ID: "msi",
            FIREBASE_APP_ID: "aid",
            FIREBASE_MEASUREMENT_ID: "mid",
          })[k] ?? null,
      );

      const res = await request(app.getHttpServer()).get(
        "/auth/firebase/config",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        apiKey: "ak",
        authDomain: "ad",
        projectId: "pid",
        storageBucket: "sb",
        messagingSenderId: "msi",
        appId: "aid",
        measurementId: "mid",
      });
    });

    it("returns nulls when the config keys are unset", async () => {
      configServiceMock.get.mockReturnValue(null);

      const res = await request(app.getHttpServer()).get(
        "/auth/firebase/config",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        apiKey: null,
        authDomain: null,
        projectId: null,
        storageBucket: null,
        messagingSenderId: null,
        appId: null,
        measurementId: null,
      });
    });
  });

  describe("POST /auth/login/firebase", () => {
    it("returns 503 when Firebase is not configured", async () => {
      firebaseAuthMock.isConfigured = false;

      const res = await request(app.getHttpServer())
        .post("/auth/login/firebase")
        .send({ idToken: "tok", workstationId: "ws" });

      expect(res.status).toBe(503);
      expect(res.body.message).toContain("Google sign-in is not enabled");
      expect(firebaseAuthMock.verifyIdToken).not.toHaveBeenCalled();
    });

    it("returns the AuthResponseDto shape on the happy path", async () => {
      firebaseAuthMock.isConfigured = true;
      const data = buildAuthResponseData();
      authServiceMock.loginWithFirebase.mockResolvedValue(data);

      const res = await request(app.getHttpServer())
        .post("/auth/login/firebase")
        .set("x-forwarded-for", "1.2.3.4")
        .send({ idToken: "tok", workstationId: "ws" });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBe("at-123");
      expect(res.body.user.id).toBe("resp-user");
      expect(res.body.offlineToken).toEqual({
        token: "ot-1",
        expiresAt: "1970-01-01T00:00:00.000Z",
      });
      expect(authServiceMock.loginWithFirebase).toHaveBeenCalledWith(
        expect.objectContaining({
          firebaseUid: "u1",
          email: "e@e.com",
          displayName: "DN",
          photoURL: "pu",
          workstationId: "ws",
          ipAddress: "1.2.3.4",
        }),
      );
    });
  });

  describe("POST /auth/bootstrap", () => {
    it("returns 404 when BOOTSTRAP_TOKEN is not configured", async () => {
      configServiceMock.get.mockReturnValue(undefined);

      const res = await request(app.getHttpServer())
        .post("/auth/bootstrap")
        .set("x-bootstrap-token", "whatever")
        .send({ email: "root@company.com" });

      expect(res.status).toBe(404);
      expect(authServiceMock.bootstrapSaasAdmin).not.toHaveBeenCalled();
    });

    it("returns 401 when the bootstrap token is missing or wrong", async () => {
      configServiceMock.get.mockImplementation((k: string) =>
        k === "BOOTSTRAP_TOKEN" ? "secret-token" : undefined,
      );

      const missing = await request(app.getHttpServer())
        .post("/auth/bootstrap")
        .send({ email: "root@company.com" });
      expect(missing.status).toBe(401);

      const wrong = await request(app.getHttpServer())
        .post("/auth/bootstrap")
        .set("x-bootstrap-token", "wrong-token")
        .send({ email: "root@company.com" });
      expect(wrong.status).toBe(401);
      expect(authServiceMock.bootstrapSaasAdmin).not.toHaveBeenCalled();
    });

    it("provisions the SAAS_ADMIN when the token matches", async () => {
      configServiceMock.get.mockImplementation((k: string) =>
        k === "BOOTSTRAP_TOKEN" ? "secret-token" : undefined,
      );
      authServiceMock.bootstrapSaasAdmin.mockResolvedValue({
        id: "saas-1",
        email: "root@company.com",
        displayName: "Root",
        role: "SAAS_ADMIN",
        status: "ACTIVE",
        isActive: true,
        authMethod: "PASSWORD_ONLY",
        emailVerifiedAt: new Date(0),
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      const res = await request(app.getHttpServer())
        .post("/auth/bootstrap")
        .set("x-bootstrap-token", "secret-token")
        .send({ email: "root@company.com", displayName: "Root" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: "saas-1",
        email: "root@company.com",
        displayName: "Root",
        role: "SAAS_ADMIN",
        status: "ACTIVE",
        isActive: true,
        authMethod: "PASSWORD_ONLY",
        emailVerifiedAt: "1970-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(authServiceMock.bootstrapSaasAdmin).toHaveBeenCalledWith({
        email: "root@company.com",
        displayName: "Root",
      });
    });

    it("rejects an invalid body with 400", async () => {
      configServiceMock.get.mockImplementation((k: string) =>
        k === "BOOTSTRAP_TOKEN" ? "secret-token" : undefined,
      );

      const res = await request(app.getHttpServer())
        .post("/auth/bootstrap")
        .set("x-bootstrap-token", "secret-token")
        .send({ email: "not-an-email" });

      expect(res.status).toBe(400);
      expect(authServiceMock.bootstrapSaasAdmin).not.toHaveBeenCalled();
    });
  });

  describe("POST /auth/refresh", () => {
    it("is protected by the JwtRefreshGuard", () => {
      const guards = Reflect.getMetadata(
        "__guards__",
        AuthController.prototype.refresh,
      ) as unknown[];

      expect(guards).toContain(JwtRefreshGuard);
    });

    it("decodes the bearer token and calls refreshSession with tokenHash and sub", async () => {
      jwtServiceMock.decode.mockReturnValue({
        sub: "user-1",
        tokenHash: "th-1",
      });
      authServiceMock.refreshSession.mockResolvedValue({
        accessToken: "at-2",
        refreshToken: "rt-2",
        expiresAt: new Date(0),
      });

      const res = await request(app.getHttpServer())
        .post("/auth/refresh")
        .set("Authorization", "Bearer some.jwt.token");

      expect(res.status).toBe(200);
      expect(authServiceMock.refreshSession).toHaveBeenCalledWith(
        "th-1",
        "user-1",
      );
      expect(res.body).toEqual({
        accessToken: "at-2",
        refreshToken: "rt-2",
        expiresAt: "1970-01-01T00:00:00.000Z",
      });
    });

    it("returns 401 when the Authorization header is missing", async () => {
      const res = await request(app.getHttpServer()).post("/auth/refresh");

      expect(res.status).toBe(401);
      expect(jwtServiceMock.decode).not.toHaveBeenCalled();
      expect(authServiceMock.refreshSession).not.toHaveBeenCalled();
    });
  });

  describe("POST /auth/verify-email", () => {
    it("redeems the token and reports the verified address", async () => {
      authServiceMock.verifyEmail.mockResolvedValue({
        email: "verified@example.com",
      });

      const res = await request(app.getHttpServer())
        .post("/auth/verify-email")
        .send({ token: "a".repeat(43) });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        verified: true,
        email: "verified@example.com",
      });
      expect(authServiceMock.verifyEmail).toHaveBeenCalledWith({
        token: "a".repeat(43),
      });
    });

    it("rejects a token longer than the Zod maximum with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/verify-email")
        .send({ token: "a".repeat(201) });

      expect(res.status).toBe(400);
      expect(authServiceMock.verifyEmail).not.toHaveBeenCalled();
    });

    // The schema's minimum is 1 so a truncated link returns
    // AUTH_INVALID_VERIFICATION_TOKEN from the service instead of a schema
    // BAD_REQUEST the client cannot distinguish from other body errors.
    it("forwards a short token to the service so it answers with the token error", async () => {
      authServiceMock.verifyEmail.mockRejectedValue(
        new InvalidVerificationTokenException(),
      );

      const res = await request(app.getHttpServer())
        .post("/auth/verify-email")
        .send({ token: "too-short" });

      expect(res.status).toBe(400);
      expect(authServiceMock.verifyEmail).toHaveBeenCalledWith({
        token: "too-short",
      });
    });
  });

  describe("POST /auth/resend-verification", () => {
    it("answers the generic acknowledgement and forwards the first forwarded IP", async () => {
      authServiceMock.requestEmailVerification.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post("/auth/resend-verification")
        .set("x-forwarded-for", "9.8.7.6, 10.0.0.1")
        .send({ email: "someone@example.com" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message:
          "If the address matches an account needing this email, a message has been sent.",
      });
      expect(authServiceMock.requestEmailVerification).toHaveBeenCalledWith({
        email: "someone@example.com",
        requestIp: "9.8.7.6",
      });
    });

    it("rejects a malformed address with 400 without touching the service", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/resend-verification")
        .send({ email: "not-an-email" });

      expect(res.status).toBe(400);
      expect(authServiceMock.requestEmailVerification).not.toHaveBeenCalled();
    });
  });

  describe("POST /auth/forgot-password", () => {
    it("returns the service acknowledgement verbatim", async () => {
      authServiceMock.forgotPassword.mockResolvedValue({
        message:
          "If the address matches an account needing this email, a message has been sent.",
      });

      const res = await request(app.getHttpServer())
        .post("/auth/forgot-password")
        .set("x-forwarded-for", "203.0.113.7")
        .send({ email: "someone@example.com" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message:
          "If the address matches an account needing this email, a message has been sent.",
      });
      expect(authServiceMock.forgotPassword).toHaveBeenCalledWith({
        email: "someone@example.com",
        requestIp: "203.0.113.7",
      });
    });
  });

  describe("POST /auth/reset-password", () => {
    it("passes the token and new password to the service", async () => {
      authServiceMock.resetPassword.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post("/auth/reset-password")
        .send({ token: "b".repeat(43), newPassword: "brand-new-secret" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: "Password reset successfully" });
      expect(authServiceMock.resetPassword).toHaveBeenCalledWith(
        "b".repeat(43),
        "brand-new-secret",
      );
    });

    it("rejects a new password below the minimum length with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/reset-password")
        .send({ token: "b".repeat(43), newPassword: "short" });

      expect(res.status).toBe(400);
      expect(authServiceMock.resetPassword).not.toHaveBeenCalled();
    });
  });
});
