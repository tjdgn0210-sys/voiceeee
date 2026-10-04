import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { clockLabel, dateLabel } from '../../application/planner/calendar-model';
import { utcToZonedFields } from '../../application/planner/zoned-time';
import type { Task } from '../../domain/task/task';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useScaler } from '../settings/settings-context';

/** A to-do under its day. The check box toggles done; the title opens the edit form. */
export function TaskRow({ task, timezone, overdue, busy, onToggle }: {
  task: Task; timezone: string; overdue?: boolean; busy?: boolean; onToggle(task: Task): void;
}) {
  const styles = useExpenseStyles();
  const s = useScaler();
  const done = task.status === 'COMPLETED';
  const due = task.dueAt ? utcToZonedFields(task.dueAt, timezone) : null;
  const meta = due ? `${overdue ? `${dateLabel(due.date)} ` : ''}${clockLabel(due.time)}까지` : '마감 없음';
  return (
    <View style={styles.listRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${task.title} 완료`}
        accessibilityState={{ checked: done, disabled: !!busy }}
        disabled={busy}
        onPress={() => onToggle(task)}
        style={{
          minWidth: s.touch, minHeight: s.touch, alignItems: 'center', justifyContent: 'center',
        }}>
        <View style={{
          width: s.icon(26), height: s.icon(26), borderRadius: 6, borderWidth: 2, borderColor: done ? palette.primary : palette.inputBorder,
          backgroundColor: done ? palette.primary : palette.paper, alignItems: 'center', justifyContent: 'center',
        }}>
          {done && <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: s.font(15) }}>✓</Text>}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${task.title}, ${done ? '완료됨, ' : ''}${meta}${overdue ? ', 마감이 지났어요' : ''}, 수정하기`}
        onPress={() => router.push({ pathname: '/entry-form', params: { type: 'task', id: task.id } })}
        style={({ pressed }) => [styles.listBody, { minHeight: s.touch, justifyContent: 'center' }, pressed && styles.pressed]}>
        <Text style={[styles.listTitle, done ? { textDecorationLine: 'line-through', color: palette.muted } : null]}>{task.title}</Text>
        <Text style={[styles.listMeta, overdue ? { color: palette.danger, fontWeight: '700' } : null]}>{overdue ? `마감 지남 · ${meta}` : meta}</Text>
      </Pressable>
    </View>
  );
}
