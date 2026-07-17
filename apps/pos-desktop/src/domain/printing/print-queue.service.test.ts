/**
 * Tests for the print job queue service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createPrintQueueService,
  type PrintQueueService,
} from "./print-queue.service";
import { PrintPayloadType, type PrintJobType, type PrintJobInput } from "./printing-types";
import { PrintPayloadNotFoundException, PrintJobNotFoundException } from "./exceptions";

function createMockPrisma() {
  const jobStore = new Map<string, any>();

  return {
    printJob: {
      create: vi.fn(async (args: any) => {
        const record = { ...args.data, id: args.data.id ?? crypto.randomUUID() };
        jobStore.set(record.id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where: { id } }: any) => jobStore.get(id) ?? null),
      findFirst: vi.fn(async (args?: any) => {
        const jobs = Array.from(jobStore.values());
        if (args?.where?.status === "PENDING") {
          return jobs
            .filter((j) => j.status === "PENDING")
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0] ?? null;
        }
        return jobs[0] ?? null;
      }),
      findMany: vi.fn(async (args?: any) => {
        let jobs = Array.from(jobStore.values());
        if (args?.where?.status === "PENDING") {
          jobs = jobs.filter((j) => j.status === "PENDING");
        } else if (args?.where?.status) {
          jobs = jobs.filter((j) => j.status === args.where.status);
        }
        if (args?.where?.jobType) {
          jobs = jobs.filter((j) => j.jobType === args.where.jobType);
        }
        return jobs;
      }),
      update: vi.fn(async ({ where: { id }, data }: any) => {
        const existing = jobStore.get(id);
        if (!existing) throw new Error("Not found");
        const updated = { ...existing, ...data, updatedAt: new Date() };
        jobStore.set(id, updated);
        return updated;
      }),
      count: vi.fn(async (args?: any) => {
        let jobs = Array.from(jobStore.values());
        if (args?.where?.status === "PENDING") {
          jobs = jobs.filter((j) => j.status === "PENDING");
        } else if (args?.where?.status) {
          jobs = jobs.filter((j) => j.status === args.where.status);
        }
        if (args?.where?.jobType) {
          jobs = jobs.filter((j) => j.jobType === args.where.jobType);
        }
        return jobs.length;
      }),
    },
    printerConfig: {
      findUnique: vi.fn(async ({ where: { id } }: any) => {
        if (id === "printer-online") {
          return { id: "printer-online", systemName: "EPSON", friendlyName: "Main", status: "ONLINE" };
        }
        if (id === "printer-offline") {
          return { id: "printer-offline", systemName: "EPSON2", friendlyName: "Offline", status: "OFFLINE" };
        }
        return null;
      }),
    },
  };
}

describe("PrintQueueService", () => {
  let service: PrintQueueService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let resolvePrinterMock: ReturnType<typeof vi.fn>;
  let executePrintMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    resolvePrinterMock = vi.fn();
    executePrintMock = vi.fn();

    // Mock fileExists indirectly by mocking @tauri-apps/api/core
    vi.mock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockResolvedValue(true),
    }));

    service = createPrintQueueService(
      mockPrisma as any,
      resolvePrinterMock as unknown as (jobType: PrintJobType) => Promise<any>,
      executePrintMock,
    );
  });

  const validInput: PrintJobInput = {
    jobType: "SALE_RECEIPT" as PrintJobType,
    payloadPath: "/tmp/receipt.pdf",
    payloadType: PrintPayloadType.PDF,
  };

  describe("enqueueJob", () => {
    it("creates a new print job with PENDING status", async () => {
      const job = await service.enqueueJob(validInput);

      expect(job.jobType).toBe("SALE_RECEIPT");
      expect(job.status).toBe("PENDING");
      expect(job.payloadPath).toBe("/tmp/receipt.pdf");
      expect(job.id).toBeTruthy();
    });

    it("uses default payload type PDF when not specified", async () => {
      const job = await service.enqueueJob({
        jobType: "SALE_RECEIPT" as PrintJobType,
        payloadPath: "/tmp/doc",
      });

      expect(job.payloadType).toBe("PDF");
    });

    it("throws PrintPayloadNotFoundException when payload file does not exist", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      (invoke as any).mockResolvedValueOnce(false);

      await expect(service.enqueueJob(validInput)).rejects.toThrow(
        PrintPayloadNotFoundException,
      );
    });

    it("resolves printer and assigns it to the job", async () => {
      resolvePrinterMock.mockResolvedValueOnce({
        id: "printer-online",
        systemName: "EPSON",
        friendlyName: "Main",
        status: "ONLINE",
      });

      const job = await service.enqueueJob(validInput);

      expect(job.printerConfigId).toBe("printer-online");
    });

    it("stores sale and user ids when provided", async () => {
      const job = await service.enqueueJob({
        ...validInput,
        createdBySaleId: "sale-123",
        createdByUserId: "user-456",
      });

      expect(job.createdBySaleId).toBe("sale-123");
      expect(job.createdByUserId).toBe("user-456");
    });
  });

  describe("getJob", () => {
    it("returns a job by id", async () => {
      const created = await service.enqueueJob(validInput);

      const job = await service.getJob(created.id);
      expect(job.id).toBe(created.id);
    });

    it("throws PrintJobNotFoundException when not found", async () => {
      await expect(service.getJob("nonexistent")).rejects.toThrow(
        PrintJobNotFoundException,
      );
    });
  });

  describe("listJobs", () => {
    it("returns all jobs with total count", async () => {
      await service.enqueueJob(validInput);
      await service.enqueueJob({ ...validInput, payloadPath: "/tmp/doc2.pdf" });

      const result = await service.listJobs();
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by job type", async () => {
      await service.enqueueJob(validInput);
      await service.enqueueJob({
        ...validInput,
        jobType: "LABEL_PRINT" as PrintJobType,
        payloadPath: "/tmp/label.pdf",
      });

      const result = await service.listJobs({ jobType: "SALE_RECEIPT" as PrintJobType });
      expect(result.items).toHaveLength(1);
    });
  });

  describe("retryJob", () => {
    it("resets a failed job to PENDING", async () => {
      const created = await service.enqueueJob(validInput);
      // Simulate job failure
      await (mockPrisma.printJob.update as any)({
        where: { id: created.id },
        data: { status: "FAILED", lastError: "Paper out" },
      });

      const retried = await service.retryJob(created.id);

      expect(retried.status).toBe("PENDING");
      expect(retried.lastError).toBeNull();
    });

    it("throws PrintJobNotFoundException when not found", async () => {
      await expect(service.retryJob("nonexistent")).rejects.toThrow(
        PrintJobNotFoundException,
      );
    });
  });

  describe("discardJob", () => {
    it("marks a job as DISCARDED with a reason", async () => {
      const created = await service.enqueueJob(validInput);

      const discarded = await service.discardJob(created.id, "Manager override");

      expect(discarded.status).toBe("DISCARDED");
      expect(discarded.lastError).toBe("Manager override");
    });

    it("throws PrintJobNotFoundException when not found", async () => {
      await expect(service.discardJob("nonexistent", "reason")).rejects.toThrow(
        PrintJobNotFoundException,
      );
    });
  });

  describe("getQueueSummary", () => {
    it("returns zeros when queue is empty", async () => {
      const summary = await service.getQueueSummary();

      expect(summary.pending).toBe(0);
      expect(summary.printing).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.discarded).toBe(0);
      expect(summary.completed24h).toBe(0);
    });
  });

  describe("countPendingForPrinter", () => {
    it("returns 0 when no jobs for the printer", async () => {
      const count = await service.countPendingForPrinter("printer-1");
      expect(count).toBe(0);
    });
  });

  describe("processNextJob", () => {
    it("does nothing when queue is empty", async () => {
      await expect(service.processNextJob()).resolves.toBeUndefined();
    });
  });

  describe("processAllPending", () => {
    it("returns { processed: 0, failed: 0 } when queue is empty", async () => {
      const result = await service.processAllPending();

      expect(result).toEqual({ processed: 0, failed: 0 });
    });
  });
});
