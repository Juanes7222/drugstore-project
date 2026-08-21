/**
 * Unit tests for ClientImportDefinition: alias mapping, identification-type
 * value aliases ('cedula' → CC), writes through ClientsService with a null
 * credit limit, and conflict detection by identity.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClientImportRow } from "@pharmacy/shared-validation";
import { ClientImportDefinition } from "./client-import.definition";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const makeMockPrisma = () => ({
  client: { findMany: vi.fn() },
});

const makeMockClientsService = () => ({
  create: vi.fn(),
});

const makeValidRow = (
  overrides: Partial<ClientImportRow> = {},
): ClientImportRow => ({
  fullName: "Juan Perez",
  identificationType: "CC",
  identificationNumber: "123456789",
  email: "juan@example.com",
  phone: "3001234567",
  address: "Calle 1",
  municipality: "Bogota",
  department: "Cundinamarca",
  creditLimit: 500000,
  ...overrides,
});

describe("ClientImportDefinition", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let clientsService: ReturnType<typeof makeMockClientsService>;
  let definition: ClientImportDefinition;

  beforeEach(() => {
    prisma = makeMockPrisma();
    clientsService = makeMockClientsService();
    definition = new ClientImportDefinition(prisma as never, clientsService as never);
  });

  describe("mapColumns", () => {
    it("maps aliases to canonical keys", () => {
      const { data } = definition.mapColumns({
        "Nombre completo": "Juan Perez",
        "Tipo de documento": "CC",
        "Numero de documento": "123456789",
        Cupo: "500000",
        Notas: "ignored",
      });

      expect(data).toEqual({
        fullName: "Juan Perez",
        identificationType: "CC",
        identificationNumber: "123456789",
        creditLimit: "500000",
      });
    });

    it("maps 'cedula' as an identification-type value via the shared schema", () => {
      const outcome = definition.validate(
        definition.mapColumns({
          "Nombre completo": "Juan Perez",
          "Tipo de documento": "cedula",
          "Numero de documento": "123456789",
        }).data,
      );
      expect("data" in outcome).toBe(true);
      if ("data" in outcome) {
        expect(outcome.data.identificationType).toBe("CC");
      }
    });

    it("rejects an unknown identification type value", () => {
      const outcome = definition.validate({
        fullName: "Juan Perez",
        identificationType: "FOREIGN_ID",
        identificationNumber: "123",
      });
      expect("issues" in outcome).toBe(true);
    });
  });

  describe("createOne", () => {
    beforeEach(() => {
      clientsService.create.mockResolvedValue({ id: "client-1" });
    });

    it("writes through ClientsService with a null credit limit when omitted", async () => {
      const created = await definition.createOne(makeValidRow({ creditLimit: undefined }));

      expect(clientsService.create).toHaveBeenCalledWith({
        fullName: "Juan Perez",
        identificationType: "CC",
        identificationNumber: "123456789",
        email: "juan@example.com",
        phone: "3001234567",
        address: "Calle 1",
        municipality: "Bogota",
        department: "Cundinamarca",
        creditLimit: null,
      });
      expect(created).toEqual({ id: "client-1" });
    });

    it("passes an explicit credit limit through", async () => {
      await definition.createOne(makeValidRow({ creditLimit: 750000 }));
      expect(clientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ creditLimit: 750000 }),
      );
    });
  });

  describe("findConflicts", () => {
    it("flags duplicate identities inside the file, keeping the first row", async () => {
      prisma.client.findMany.mockResolvedValue([]);
      const conflicts = await definition.findConflicts([
        { rowNumber: 2, data: makeValidRow() },
        { rowNumber: 3, data: makeValidRow() },
      ]);

      expect(conflicts.has(2)).toBe(false);
      expect(conflicts.get(3)).toEqual([
        {
          path: "identificationNumber",
          message:
            "El documento CC 123456789 se repite en el archivo (fila 2)",
        },
      ]);
    });

    it("flags identities that already exist in the database", async () => {
      prisma.client.findMany.mockResolvedValue([
        { identificationType: "CC", identificationNumber: "123456789" },
      ]);
      const conflicts = await definition.findConflicts([
        { rowNumber: 2, data: makeValidRow() },
      ]);

      expect(conflicts.get(2)).toEqual([
        {
          path: "identificationNumber",
          message: "El documento CC 123456789 ya existe en el sistema",
        },
      ]);
    });

    it("queries the database with one OR branch per unique identity", async () => {
      prisma.client.findMany.mockResolvedValue([]);
      await definition.findConflicts([
        { rowNumber: 2, data: makeValidRow() },
        { rowNumber: 3, data: makeValidRow({ identificationNumber: "987" }) },
      ]);

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { identificationType: "CC", identificationNumber: "123456789" },
            { identificationType: "CC", identificationNumber: "987" },
          ],
        },
        select: { identificationType: true, identificationNumber: true },
      });
    });

    it("returns an empty map when there are no conflicts", async () => {
      prisma.client.findMany.mockResolvedValue([]);
      const conflicts = await definition.findConflicts([
        { rowNumber: 2, data: makeValidRow() },
      ]);
      expect(conflicts.size).toBe(0);
    });
  });
});
