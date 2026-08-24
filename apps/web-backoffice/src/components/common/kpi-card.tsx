import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

export type KpiTone = "default" | "ok" | "info" | "warning" | "error";

/** Accepts both MUI icon components and the local AppIcon components. */
export type KpiIconComponent = ComponentType<
  Pick<SvgIconProps, "fontSize"> & { size?: number | string }
>;

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: KpiIconComponent;
  tone?: KpiTone;
  /** Position in the grid; drives the entrance stagger delay. */
  index?: number;
  /** Shows a pulsing dot: the metric describes something live right now. */
  live?: boolean;
}

const TONE_COLOR: Record<KpiTone, string> = {
  default: "text.primary",
  ok: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main",
};

/**
 * KPI card. Tone is carried by the icon chip (and value color only for
 * problem states) so healthy metrics stay quiet and risk pops out.
 */
export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone = "default",
  index = 0,
  live = false,
}: KpiCardProps) {
  const theme = useTheme();
  const toneHex =
    tone === "default"
      ? theme.palette.text.secondary
      : (theme.palette[TONE_COLOR[tone].split(".")[0] as "success" | "info" | "warning" | "error"])
          .main;
  const isProblem = tone === "warning" || tone === "error";

  return (
    <Card
      variant="outlined"
      className="animate-fade-up"
      sx={{
        height: "100%",
        bgcolor: "background.paper",
        // Stagger entrance; capped so late cards never feel slow.
        animationDelay: `${Math.min(index * 35, 280)}ms`,
      }}
    >
      <CardContent>
        <Box
          display="flex"
          alignItems="flex-start"
          justifyContent="space-between"
          gap={1}
        >
          <Box minWidth={0}>
            <Typography variant="overline" component="p" color="text.secondary" noWrap>
              {title}
            </Typography>
            <Typography
              component="p"
              fontSize={26}
              lineHeight={1.25}
              fontWeight={700}
              sx={{
                color: isProblem ? TONE_COLOR[tone] : "text.primary",
                fontVariantNumeric: "tabular-nums",
              }}
              noWrap
            >
              {live ? (
                <Box
                  component="span"
                  aria-hidden
                  sx={{ display: "inline-flex", alignItems: "center", mr: 1 }}
                >
                  <Box
                    component="span"
                    sx={{
                      position: "relative",
                      display: "inline-flex",
                      width: 8,
                      height: 8,
                    }}
                  >
                    <Box
                      component="span"
                      className="animate-ping"
                      sx={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        bgcolor: "#10B981",
                        opacity: 0.55,
                      }}
                    />
                    <Box
                      component="span"
                      sx={{
                        position: "relative",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "#10B981",
                      }}
                    />
                  </Box>
                </Box>
              ) : null}
              {value}
            </Typography>
            {subtitle ? (
              <Typography variant="caption" color="text.secondary" noWrap display="block">
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {Icon ? (
            <Box
              aria-hidden
              display="flex"
              alignItems="center"
              justifyContent="center"
              sx={{
                width: 36,
                height: 36,
                borderRadius: 2,
                flexShrink: 0,
                color: toneHex,
                bgcolor:
                  tone === "default"
                    ? alpha(theme.palette.text.primary, 0.05)
                    : alpha(toneHex, 0.12),
              }}
            >
              <Icon fontSize="small" />
            </Box>
          ) : null}
        </Box>
      </CardContent>
    </Card>
  );
}
