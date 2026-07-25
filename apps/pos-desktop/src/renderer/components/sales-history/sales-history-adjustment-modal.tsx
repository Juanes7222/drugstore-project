/**
 * Sales history adjustment modal — loads the local client catalog so the
 * CLIENT_CHANGE editor can offer a searchable client picker.
 *
 * This is a thin wrapper around the generic AdjustmentCreationModal; it stays
 * inside the presentational layer and only talks to the service context.
 */
import { type FC, useEffect, useState } from 'react';
import { useClientsService } from '../common/service-context';
import { AdjustmentCreationModal } from '../fiscal/adjustment-creation-modal';
import type {
  AdjustmentType,
  OperationalInvoiceView,
} from '../../../domain/fiscal/local-adjustment.types';

export interface SalesHistoryAdjustmentModalProps {
  visible: boolean;
  saleId: string;
  invoiceId: string;
  invoiceStatus: string;
  operationalView: OperationalInvoiceView | null;
  allowedTypes: AdjustmentType[];
  loading: boolean;
  error: string | null;
  onSubmit: (
    type: AdjustmentType,
    newValue: unknown,
    reason: string,
  ) => Promise<void>;
  onClose: () => void;
}

export interface ClientOption {
  id: string;
  name: string;
  identificationType: string;
  identificationNumber: string;
}

export const SalesHistoryAdjustmentModal: FC<SalesHistoryAdjustmentModalProps> = ({
  visible,
  invoiceId,
  invoiceStatus,
  operationalView,
  allowedTypes,
  loading,
  error,
  onSubmit,
  onClose,
}) => {
  const clientsService = useClientsService();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;

    setClientsLoading(true);
    clientsService
      .search()
      .then((results) =>
        setClients(
          results.map((client) => ({
            id: client.id,
            name: client.fullName,
            identificationType: client.identificationType,
            identificationNumber: client.identificationNumber,
          })),
        ),
      )
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false));
  }, [visible, clientsService]);

  return (
    <AdjustmentCreationModal
      visible={visible}
      invoiceId={invoiceId}
      invoiceStatus={invoiceStatus}
      operationalView={operationalView}
      allowedTypes={allowedTypes}
      loading={loading || clientsLoading}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
      clients={clients}
    />
  );
};

