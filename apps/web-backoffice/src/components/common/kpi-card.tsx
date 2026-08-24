import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { SvgIconComponent } from "@mui/icons-material";

export type KpiTone = "default" | "ok" | "info" | "warning" | "error";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: SvgIconComponent;
  tone?: KpiTone;
}

const TONE_COLOR: Record<KpiTone, string> = {
  default: "text.primary",
  ok: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main",
};

const TONE_BG: Record<KpiTone, string> = {
  default: "transparent",
  ok: "success.light",
  info: "info.light",
  warning: "warning.light",
  error: "error.light",
};

/** KPI card used on the dashboard. Non-default tones signal problem states. */
export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone = "default",
}: KpiCardProps) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderLeft: `4px solid`,
        borderLeftColor: TONE_COLOR[tone],
        bgcolor: TONE_BG[tone],
      }}
    >
      <CardContent>
        <Box
          display="flex"
          alignItems="flex-start"
          justifyContent="space-between"
        >
          <Box minWidth={0}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {title}
            </Typography>
            <Typography
              variant="h6"
              fontWeight={700}
              sx={{ color: TONE_COLOR[tone] }}
              noWrap
            >
              {value}
            </Typography>
            {subtitle ? (
              <Typography variant="caption" color="text.secondary" noWrap>
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
                width: 40,
                height: 40,
                borderRadius: 2,
                flexShrink: 0,
                bgcolor: "background.paper",
                color: TONE_COLOR[tone],
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
