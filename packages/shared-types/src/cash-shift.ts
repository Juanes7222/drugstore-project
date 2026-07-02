export interface CashShift {
  id: string;
  cashierId: string;
  openingAmount: string;
  closingAmount: string | null;
  expectedAmount: string | null;
  difference: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
}
