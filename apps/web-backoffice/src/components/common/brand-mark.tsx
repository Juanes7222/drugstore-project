import Box from "@mui/material/Box";
import { MedicalServicesIcon } from "../icons/app-icons";

interface BrandMarkProps {
  /** Edge length of the rounded tile in px. */
  size?: number;
}

/** Pharmacy mortar-and-pestle mark on a teal gradient tile. */
export function BrandMark({ size = 32 }: BrandMarkProps) {
  return (
    <Box
      aria-hidden
      display="flex"
      alignItems="center"
      justifyContent="center"
      sx={{
        width: size,
        height: size,
        borderRadius: 2,
        flexShrink: 0,
        color: "#FFFFFF",
        background: "linear-gradient(135deg, #0E7490 0%, #06B6D4 100%)",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.18)",
      }}
    >
      <MedicalServicesIcon size={Math.round(size * 0.62)} />
    </Box>
  );
}
