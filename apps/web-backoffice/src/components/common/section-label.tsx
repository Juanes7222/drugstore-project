import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

interface SectionLabelProps {
  children: ReactNode;
}

/**
 * Ticket-style group label for dashboard sections. Uppercase micro-label
 * encodes the operational domain the grouped KPIs belong to.
 */
export function SectionLabel({ children }: SectionLabelProps) {
  return (
    <Typography
      variant="overline"
      component="h2"
      color="text.secondary"
      sx={{ display: "block", mt: 0.5 }}
    >
      {children}
    </Typography>
  );
}
