/**
 * Local prescription registration service for the POS desktop app.
 *
 * Captures prescription data (prescriber, patient, controlled-substance
 * tracking) for a given sale item and queues it for sync.
 *
 * ## Architecture notes
 *
 * ### Relation to sales
 * A prescription is linked 1:1 to a SaleItem via `saleItemPrescriptionId`.
 * The sale item must exist in the local database and must NOT already have
 * a prescription. The link is established at sale item creation time
 * (SaleItem.requiresPrescription = true) or retroactively when the
 * physical prescription is later captured.
 *
 * ### Controlled substances
 * Per Decreto 780/2016, controlled substance prescriptions require the
 * prescriber's full data, a prescription number, and the book entry/page
 * where the transaction is recorded. The service validates these fields
 * when `isControlledSubstance = true`.
 *
 * ### Sync integration
 * On creation, a SyncQueue row with operationType PRESCRIPTION_REGISTRATION
 * is created inside the same transaction. The server re-validates the
 * prescription data for fiscal compliance.
 */
import { PrismaClient, RecipeType } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  PrescriptionSaleItemNotFoundException,
  PrescriptionNotFoundException,
  ControlledSubstanceFieldsRequiredException,
  PrescriptionAlreadyExistsException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export interface CreatePrescriptionInput {
  saleItemId: string;
  prescriptionNumber?: string;
  prescriberIdType?: string;
  prescriberIdNumber?: string;
  prescriberName?: string;
  prescriberSpecialty?: string;
  prescriptionDate?: string; // ISO date string
  expiresAt?: string; // ISO date string
  patientFullName?: string;
  patientIdType?: string;
  patientIdNumber?: string;
  fileUrl?: string;
  fileHash?: string;
  isControlledSubstance?: boolean;
  controlledSubstanceBookEntry?: string;
  controlledSubstanceBookPage?: string;
  recipeType?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createPrescriptionsService = (
  prisma: PrismaClient,
  auth: AuthService,
): PrescriptionsService => {
  return new PrescriptionsService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * Attach a prescription to an existing sale item.
   *
   * Requires CASHIER or ADMIN role.
   *
   * 1. Validates the sale item exists.
   * 2. Validates that no prescription is already attached.
   * 3. Validates controlled-substance mandatory fields.
   * 4. Creates the Prescription record and links it to the sale item.
   * 5. Inserts a SyncQueue row (operationType: PRESCRIPTION_REGISTRATION).
   *
   * @throws PrescriptionSaleItemNotFoundException if the sale item does not exist.
   * @throws PrescriptionAlreadyExistsException if the sale item already has a prescription.
   * @throws ControlledSubstanceFieldsRequiredException if controlled-substance fields are incomplete.
   */
  async create(input: CreatePrescriptionInput): Promise<unknown> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      // 1. Validate sale item exists and doesn't already have a prescription
      const saleItem = await tx.saleItem.findUnique({
        where: { id: input.saleItemId },
      });
      if (!saleItem) {
        throw new PrescriptionSaleItemNotFoundException(input.saleItemId);
      }

      // Check existing prescription via the relation field
      const existingPrescription = await tx.prescription.findUnique({
        where: { saleItemId: input.saleItemId },
      });
      if (existingPrescription) {
        throw new PrescriptionAlreadyExistsException(input.saleItemId);
      }

      // 2. Validate controlled substance mandatory fields
      const isControlledSubstance = input.isControlledSubstance ?? false;
      if (isControlledSubstance) {
        if (!input.prescriptionNumber) {
          throw new ControlledSubstanceFieldsRequiredException('prescriptionNumber');
        }
        if (!input.controlledSubstanceBookEntry) {
          throw new ControlledSubstanceFieldsRequiredException('controlledSubstanceBookEntry');
        }
        if (!input.controlledSubstanceBookPage) {
          throw new ControlledSubstanceFieldsRequiredException('controlledSubstanceBookPage');
        }
        if (!input.prescriberIdNumber) {
          throw new ControlledSubstanceFieldsRequiredException('prescriberIdNumber');
        }
        if (!input.prescriberName) {
          throw new ControlledSubstanceFieldsRequiredException('prescriberName');
        }
      }

      // 3. Create the prescription
      const prescription = await tx.prescription.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          saleItemId: input.saleItemId,
          prescriptionNumber: input.prescriptionNumber ?? null,
          prescriberIdType: (input.prescriberIdType as any) ?? null,
          prescriberIdNumber: input.prescriberIdNumber ?? null,
          prescriberName: input.prescriberName ?? null,
          prescriberSpecialty: input.prescriberSpecialty ?? null,
          prescriptionDate: input.prescriptionDate ? new Date(input.prescriptionDate) : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          patientFullName: input.patientFullName ?? null,
          patientIdType: (input.patientIdType as any) ?? null,
          patientIdNumber: input.patientIdNumber ?? null,
          fileUrl: input.fileUrl ?? null,
          fileHash: input.fileHash ?? null,
          isControlledSubstance,
          controlledSubstanceBookEntry: input.controlledSubstanceBookEntry ?? null,
          controlledSubstanceBookPage: input.controlledSubstanceBookPage ?? null,
          recipeType: (input.recipeType as RecipeType) ?? null,
          verifiedById: session.userId,
          verifiedAt: new Date(),
        },
      });

      // 4. Link to sale item
      await tx.saleItem.update({
        where: { id: input.saleItemId },
        data: {
          saleItemPrescriptionId: prescription.id,
          requiresPrescription: true,
        },
      });

      // 5. Insert SyncQueue entry
      await this.createSyncQueueEntry(
        tx,
        prescription,
        session,
        prescription.createdAt,
      );

      return prescription;
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    prescription: {
      id: string;
      saleItemId: string;
      prescriptionNumber: string | null;
      prescriberIdNumber: string | null;
      prescriberName: string | null;
      isControlledSubstance: boolean;
      createdAt: Date;
    },
    session: { userId: string; workstationId: string },
    createdAt: Date,
  ): Promise<void> {
    const payloadObj = {
      prescriptionId: prescription.id,
      saleItemId: prescription.saleItemId,
      prescriptionNumber: prescription.prescriptionNumber,
      prescriberIdNumber: prescription.prescriberIdNumber,
      prescriberName: prescription.prescriberName,
      isControlledSubstance: prescription.isControlledSubstance,
      metadata: {
        userId: session.userId,
        workstationId: session.workstationId,
        createdAt: createdAt.toISOString(),
      },
    };

    const payload = JSON.stringify(payloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadSize = payloadBytes.length;
    const payloadHash = await this.computePayloadHash(payload);
    const operationUuid = globalThis.crypto.randomUUID();

    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid,
        operationType: 'PRESCRIPTION_REGISTRATION',
        payload,
        payloadHash,
        payloadSize,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: session.workstationId,
        sourceCreatedAt: createdAt,
        clientSequence,
      },
    });
  }

  private async computePayloadHash(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
