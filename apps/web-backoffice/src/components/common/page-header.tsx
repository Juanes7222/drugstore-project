import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Standard page header with title, optional subtitle and action slot. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Box
      component="header"
      display="flex"
      flexWrap="wrap"
      alignItems="center"
      justifyContent="space-between"
      gap={2}
      mb={3}
    >
      <Box>
        <Typography variant="h5" component="h1" fontWeight={600}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {actions ? <Box display="flex" gap={1} alignItems="center">{actions}</Box> : null}
    </Box>
  );
}