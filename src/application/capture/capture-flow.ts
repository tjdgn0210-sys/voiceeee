import type { Transaction } from '../../domain/transaction/transaction';
import type { ManualExpenses } from '../expenses/manual-expenses';
import type { UndoBar } from '../undo/undo-bar';
import type { UndoResult } from '../undo/undo-created-transaction';
import type { CreateTransactionProposal } from '../validator/validate-create-transaction';

/** The same amount and memo saved this recently counts as a possible double entry (README 3.1 #5, blueprint 15). */
export const DUPLICATE_WINDOW_MS = 3 * 60_000;

export type CaptureSource = 'LOCAL' | 'AI';

export type ParsedOutcome =
  | { status: 'SAVED'; proposal: CreateTransactionProposal; transactionId: string }
  /** Looks like the record just saved: nothing is written until the user says so. */
  | { status: 'DUPLICATE'; proposal: CreateTransactionProposal; existing: Transaction }
  /** AI results are still confirmed before saving (the multi-action cards come in M3). */
  | { status: 'REVIEW'; proposal: CreateTransactionProposal }
  | { status: 'CLARIFY'; message: string }
  | { status: 'FAILED'; message: string };

export interface CaptureFlowDependencies {
  save: ManualExpenses['save'];
  recentExpenses(limit: number): Promise<Transaction[]>;
  undo(undoId: string): Promise<UndoResult>;
  undoBar: Pick<UndoBar, 'show'>;
  now(): string;
}

const sameMemo = (left: string | null, right: string | null) => (left ?? '').trim() === (right ?? '').trim();

/** The expense saved within the window with the same amount and memo, if any. */
export function findRecentDuplicate(proposal: CreateTransactionProposal, recent: readonly Transaction[], now: string): Transaction | null {
  const amount = proposal.payload.amount;
  return recent.find(item => item.type === 'EXPENSE' && item.amount === amount && sameMemo(item.memo, proposal.payload.memo)
    && Date.parse(now) - Date.parse(item.createdAt) >= 0 && Date.parse(now) - Date.parse(item.createdAt) <= DUPLICATE_WINDOW_MS) ?? null;
}

/**
 * What happens to a parsed expense: a local result is saved at once (with an undo offer, not a confirmation screen),
 * a probable double entry waits for the user, and an AI result is shown for confirmation.
 */
export function createCaptureFlow(dependencies: CaptureFlowDependencies) {
  async function saveNow(proposal: CreateTransactionProposal): Promise<ParsedOutcome> {
    const saved = await dependencies.save(proposal);
    if (saved.validation.status === 'NEEDS_CLARIFICATION') {
      return { status: 'CLARIFY', message: saved.validation.clarifications.map(item => item.question).join(' ') };
    }
    if (saved.validation.status !== 'VALID') return { status: 'FAILED', message: '입력 내용을 확인해 주세요.' };
    if (saved.outcome?.result.status !== 'SUCCESS' || !saved.outcome.result.affectedEntityId) {
      return { status: 'FAILED', message: '저장을 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요.' };
    }
    const undoId = saved.outcome.undoRecord?.undoId;
    if (undoId) {
      const label = `${proposal.payload.category || '미분류'} ${proposal.payload.amount?.toLocaleString('ko-KR')}원을 저장했어요`;
      dependencies.undoBar.show({ label, undo: () => dependencies.undo(undoId) });
    }
    return { status: 'SAVED', proposal, transactionId: saved.outcome.result.affectedEntityId };
  }

  return {
    async handleParsed(proposal: CreateTransactionProposal, source: CaptureSource): Promise<ParsedOutcome> {
      if (source === 'AI') return { status: 'REVIEW', proposal };
      const existing = findRecentDuplicate(proposal, await dependencies.recentExpenses(10), dependencies.now());
      if (existing) return { status: 'DUPLICATE', proposal, existing };
      return saveNow(proposal);
    },
    /** The user confirmed: a repeated entry, or an AI result. */
    saveConfirmed: saveNow,
  };
}

export type CaptureFlow = ReturnType<typeof createCaptureFlow>;
