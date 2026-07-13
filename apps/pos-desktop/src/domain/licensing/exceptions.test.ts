import { describe, expect, it } from "vitest";
import { DomainError } from "../../common/domain-error";
import {
  ActivationFailedException,
  AlreadyActivatedException,
  CheckInFailedException,
  LicenseInvalidException,
  TokenVerificationFailedException,
} from "./exceptions";

describe("LicenseInvalidException", () => {
  it("extends DomainError", () => {
    const error = new LicenseInvalidException();
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
  });

  it("has the correct error code", () => {
    const error = new LicenseInvalidException();
    expect(error.errorCode).toBe("LICENSE_INVALID");
  });

  it("has the default Spanish message", () => {
    const error = new LicenseInvalidException();
    expect(error.message).toBe(
      "La suscripción está vencida. Contacta a tu proveedor para renovar.",
    );
  });

  it("sets the name to the constructor name", () => {
    const error = new LicenseInvalidException();
    expect(error.name).toBe("LicenseInvalidException");
  });
});

describe("ActivationFailedException", () => {
  it("extends DomainError", () => {
    const error = new ActivationFailedException("reason");
    expect(error).toBeInstanceOf(DomainError);
  });

  it("has the correct error code", () => {
    const error = new ActivationFailedException("Servidor no responde");
    expect(error.errorCode).toBe("ACTIVATION_FAILED");
  });

  it("carries the provided reason as the message", () => {
    const error = new ActivationFailedException("Código inválido");
    expect(error.message).toBe("Código inválido");
  });
});

describe("CheckInFailedException", () => {
  it("extends DomainError", () => {
    const error = new CheckInFailedException("Network error");
    expect(error).toBeInstanceOf(DomainError);
  });

  it("has the correct error code", () => {
    const error = new CheckInFailedException("timeout");
    expect(error.errorCode).toBe("CHECK_IN_FAILED");
  });

  it("carries the provided reason as the message", () => {
    const error = new CheckInFailedException("Server unreachable");
    expect(error.message).toBe("Server unreachable");
  });
});

describe("AlreadyActivatedException", () => {
  it("extends DomainError", () => {
    const error = new AlreadyActivatedException();
    expect(error).toBeInstanceOf(DomainError);
  });

  it("has the correct error code", () => {
    const error = new AlreadyActivatedException();
    expect(error.errorCode).toBe("ALREADY_ACTIVATED");
  });

  it("has the default Spanish message", () => {
    const error = new AlreadyActivatedException();
    expect(error.message).toBe("Este punto de venta ya está activado.");
  });
});

describe("TokenVerificationFailedException", () => {
  it("extends DomainError", () => {
    const error = new TokenVerificationFailedException("expired");
    expect(error).toBeInstanceOf(DomainError);
  });

  it("has the correct error code", () => {
    const error = new TokenVerificationFailedException("Token malformed");
    expect(error.errorCode).toBe("TOKEN_VERIFICATION_FAILED");
  });

  it("carries the provided reason as the message", () => {
    const error = new TokenVerificationFailedException("Signature invalid");
    expect(error.message).toBe("Signature invalid");
  });
});
