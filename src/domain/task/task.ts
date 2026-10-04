import type { EntityId, ISODateTime, Visibility } from '../common/primitives';

export type TaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export interface Task {
  id: EntityId;
  title: string;
  dueAt: ISODateTime | null;
  status: TaskStatus;
  completedAt: ISODateTime | null;
  visibility: Visibility;
  sourceActionId: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}
