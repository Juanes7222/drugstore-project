/**
 * Local report scheduler.
 *
 * Persists report schedules in `localStorage` (via Zustand) and runs them
 * in the foreground while the application is open.  No background
 * threads, no notifications out to email — when a schedule fires we
 * generate the export file and surface an in-app notification.
 *
 * ## Why not server-side?
 * The product scope is local-first.  A schedule is a user convenience
 * (e.g. "give me the daily summary as a PDF when I open the app on
 * Monday") and never a guarantee about a closed application.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getReportDefinition, REPORT_CATALOG } from './report-catalog';
import { validateFilters } from './report-filter-schemas';
import { ReportExecutionService } from './report-execution.service';
import { ReportExportService } from './report-export.service';
import type { LocalSession } from '../auth/local-session.store';
import type { PrismaClient } from '@pharmacy/database/local';
import type { ReportCode, ReportExportFormat } from './report-types';

export interface ReportSchedule {
  id: string;
  reportCode: ReportCode;
  /** "monday" .. "sunday".  Lowercase English. */
  weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  /** "HH:mm" 24-hour time in Colombia local time. */
  time: string;
  format: ReportExportFormat;
  filters: Record<string, unknown>;
  /** ISO 8601 timestamp of the last run, or null. */
  lastRunAt: string | null;
  /** ISO 8601 timestamp of the next scheduled run. */
  nextRunAt: string | null;
  /** Local user display name shown in the notification. */
  createdBy: string;
  createdAt: string;
}

export interface ScheduleExecutionResult {
  scheduleId: string;
  /** Path the file was saved to, or null when a browser download was triggered. */
  filename: string | null;
  runAt: string;
}

interface ScheduleState {
  schedules: ReportSchedule[];
  add: (schedule: Omit<ReportSchedule, 'id' | 'createdAt' | 'lastRunAt' | 'nextRunAt'>) => ReportSchedule;
  remove: (id: string) => void;
  toggle: (id: string, active: boolean) => void;
  markRun: (id: string, result: ScheduleExecutionResult) => void;
  list: () => ReportSchedule[];
}

const STORAGE_KEY = 'pharmacy_report_schedules';

const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      schedules: [],
      add: (input) => {
        const schedule: ReportSchedule = {
          ...input,
          id: globalThis.crypto.randomUUID(),
          lastRunAt: null,
          nextRunAt: computeNextRun(input.weekday, input.time),
          createdAt: new Date().toISOString(),
        };
        set({ schedules: [...get().schedules, schedule] });
        return schedule;
      },
      remove: (id) => set({ schedules: get().schedules.filter((s) => s.id !== id) }),
      toggle: (id, active) =>
        set({
          schedules: get().schedules.map((s) =>
            s.id === id ? { ...s, nextRunAt: active ? computeNextRun(s.weekday, s.time) : null } : s,
          ),
        }),
      markRun: (id, result) =>
        set({
          schedules: get().schedules.map((s) =>
            s.id === id
              ? {
                  ...s,
                  lastRunAt: result.runAt,
                  nextRunAt: computeNextRun(s.weekday, s.time),
                }
              : s,
          ),
        }),
      list: () => get().schedules,
    }),
    { name: STORAGE_KEY, storage: createJSONStorage(() => localStorage) },
  ),
);

export const useReportSchedulesStore = useScheduleStore;

/** Run pending schedules against the local execution service. */
export class ReportScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    _prisma: PrismaClient,
    private readonly execution: ReportExecutionService,
    private readonly exporter: ReportExportService,
    private readonly getSession: () => LocalSession | null,
  ) {}

  /** Start the 60-second tick that evaluates pending schedules. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    // Also evaluate on start so a freshly opened app runs any due schedules.
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Inspect every schedule and run any whose `nextRunAt` is in the past. */
  async tick(): Promise<ScheduleExecutionResult[]> {
    const session = this.getSession();
    if (!session) return [];
    const now = new Date();
    const due = useScheduleStore.getState().schedules.filter(
      (s) => s.nextRunAt && new Date(s.nextRunAt) <= now,
    );
    const results: ScheduleExecutionResult[] = [];
    for (const schedule of due) {
      try {
        const result = await this.runSchedule(schedule, session);
        if (result) {
          results.push(result);
          useScheduleStore.getState().markRun(schedule.id, result);
        }
      } catch (err) {
        console.error(
          `[ReportScheduler] Schedule ${schedule.id} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return results;
  }

  private async runSchedule(
    schedule: ReportSchedule,
    session: LocalSession,
  ): Promise<ScheduleExecutionResult | null> {
    const definition = getReportDefinition(schedule.reportCode);
    if (!definition.allowedRoles.includes(session.role as never)) return null;
    const filters = validateFilters(schedule.reportCode, schedule.filters);
    const response = await this.execution.run({
      code: schedule.reportCode,
      filters,
      session,
    });
    const prefix = REPORT_CATALOG.find((r) => r.code === schedule.reportCode)
      ? schedule.reportCode.toLowerCase().replace(/_/gu, '-')
      : 'report';
    const filename = await this.exporter.exportAndDownload({
      response,
      definition,
      format: schedule.format,
      filenamePrefix: `scheduled-${prefix}`,
      userDisplayName: session.fullName ?? session.userId,
      showDialog: false,
    });
    return {
      scheduleId: schedule.id,
      filename,
      runAt: new Date().toISOString(),
    };
  }
}

function computeNextRun(weekday: ReportSchedule['weekday'], time: string): string {
  const [hh, mm] = time.split(':').map((p) => Number(p));
  const now = new Date();
  const target = new Date(now);
  target.setHours(hh ?? 8, mm ?? 0, 0, 0);
  const dayIndex = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekday);
  let delta = dayIndex - target.getDay();
  if (delta < 0 || (delta === 0 && target.getTime() <= now.getTime())) delta += 7;
  target.setDate(target.getDate() + delta);
  return target.toISOString();
}
