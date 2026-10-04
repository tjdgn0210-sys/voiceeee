import type { CurrencyCode, EntityId, InputMethod, ISODateTime } from '../common/primitives';

export type TransactionType = 'EXPENSE' | 'INCOME';

export interface Transaction {
  id: EntityId;
  type: TransactionType;
  /** Positive safe integer; never signed for direction. Validate before persistence. */
  amount: number;
  currencyCode: CurrencyCode;
  category: string | null;
  memo: string | null;
  /** False keeps the record in lists but out of totals. */
  includeInTotal: boolean;
  /** Item names of a bundled expense, kept apart from memo; null when not bundled. */
  bundleItems: string[] | null;
  occurredAt: ISODateTime;
  inputMethod: InputMethod;
  rawInput: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}
