/**
 * Local report empty state.
 */

import { type FC } from "react";
import { Inbox } from "lucide-react";

interface ReportEmptyStateProps {
  title: string;
  body: string;
}

export const ReportEmptyState: FC<ReportEmptyStateProps> = ({ title, body }) => (
  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white p-8 text-center text-muted">
    <Inbox className="h-8 w-8" aria-hidden />
    <h3 className="text-body font-semibold text-ink">{title}</h3>
    <p className="text-body-sm">{body}</p>
  </div>
);
