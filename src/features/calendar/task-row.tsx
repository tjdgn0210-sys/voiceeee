import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { clockLabel, dateLabel } from '../../application/planner/calendar-model';
import { utcToZonedFields } from '../../application/planner/zoned-time';
import type { Task } from '../../domain/task/task';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useScaler } from '../settings/settings-context';

/** A to-do under its day (design .agendaItem + .taskToggle). The round box toggles done; the text opens the edit form. */
export function TaskRow({ task, timezone, overdue, busy, onToggle }: {
  task: Task; timezone: string; overdue?: boolean; busy?: boolean; onToggle(task: Task): void;
}) {
  const styles = useExpenseStyles();
  const s = useScaler();
  const done = task.status === 'COMPLETED';
  const due = task.dueAt ? utcToZonedFields(task.dueAt, timezone) : null;
  const meta = due ? `${overdue ? `${dateLabel(due.date)} ` : ''}${clockLabel(due.time)}까지` : '마감 없음';
  const box = s.icon(26);
  return (
    <View style={styles.listRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${task.title} 완료`}
        accessibilityState={{ checked: done, disabled: !!busy }}
        aria-checked={done}
        disabled={busy}
        onPress={() => onToggle(task)}
        style={{ width: Math.max(48, s.space(48)), height: Math.max(48, s.space(48)), alignItems: 'center', justifyContent: 'center' }}>
        <View style={{
          width: box, height: box, borderRadius: box / 2, borderWidth: 2, borderColor: done ? palette.primaryFill : palette.muted,
          backgroundColor: done ? palette.primaryFill : 'transparent', alignItems: 'center', justifyContent: 'center',
        }}>
          {done && <Text style={{ color: palette.onPrimary, fontWeight: '700', fontSize: s.font(15), lineHeight: s.font(18) }}>✓</Text>}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${task.title}, ${done ? '완료됨, ' : ''}${meta}${overdue ? ', 마감이 지났어요' : ''}, 수정하기`}
        onPress={() => router.push({ pathname: '/entry-form', params: { type: 'task', id: task.id } })}
        style={({ pressed }) => [styles.listBody, { minHeight: Math.max(84, s.space(84)), justifyContent: 'center' }, pressed && styles.pressed]}>
        <Text style={styles.listTime}>{meta}</Text>
        <Text style={[styles.listTitle, done ? { textDecorationLine: 'line-through', color: palette.muted } : null]}>{task.title}</Text>
        {overdue && <Text style={{ fontSize: s.font(12), lineHeight: s.font(17), color: palette.danger }}>마감 지남</Text>}
      </Pressable>
    </View>
  );
}
