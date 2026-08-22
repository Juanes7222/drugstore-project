import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Box textAlign="center" py={8}>
      <Typography variant="h4" component="h1" gutterBottom>
        {t('common.notFound')}
      </Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>
        {t('common.notFoundHint')}
      </Typography>
      <Button component={Link} to="/dashboard" variant="contained">
        {t('common.backToDashboard')}
      </Button>
    </Box>
  );
}