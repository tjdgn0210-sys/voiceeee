import { useCallback, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  dateLabel, dayOrEmpty, indexCalendar, monthGrid, monthTitle, shiftMonth, visibleRange, weekDates, weekTitle, WEEKDAY_NAMES,
  type CalendarDay, type CalendarIndex,
} from '../../application/planner/calendar-model';
import type { PlannerRangeData } from '../../application/planner/planner-services';
import { addDays } from '../../application/planner/zoned-time';
import { localDateIn } from '../../application/validator/local-date';
import type { LocalDate } from '../../domain/common/primitives';
import type { Task } from '../../domain/task/task';
import { Radius, Spacing } from '../../constants/theme';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useScaler } from '../settings/settings-context';
import { SegmentControl } from './form-controls';
import { EventRow } from './event-row';
import { usePlanner } from './planner-context';
import { TaskRow } from './task-row';

type View_ = 'month' | 'week';
const VIEW_OPTIONS: readonly { value: View_; label: string }[] = [{ value: 'month', label: '월' }, { value: 'week', label: '주' }];

/** K1: month and week views, a dot for each day with something, the selected day's list, and [새로 적기]. */
export function CalendarScreen() {
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const s = useScaler();
  const timezone = planner.timezone();
  const [view, setView] = useState<View_>('month');
  const [selected, setSelected] = useState<LocalDate>(() => localDateIn(timezone, planner.now()));
  const [data, setData] = useState<PlannerRangeData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const toggling = useRef(false);
  const today = localDateIn(timezone, planner.now());
  const range = useMemo(() => visibleRange(view, selected), [view, selected]);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      try {
        const loaded = await planner.loadRange(range.from, range.until);
        if (active) { setData(loaded); setStatus('ready'); }
      } catch {
        if (active) setStatus('error');
      }
    }
    void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; subscription.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicit invalidation key reloads committed local data.
  }, [planner, range.from, range.until, attempt]));

  const index: CalendarIndex | null = useMemo(
    () => (data ? indexCalendar(data.events, data.tasks, planner.now(), timezone) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- "now" only matters when the data is reloaded.
    [data, timezone],
  );
  const reload = () => setAttempt(value => value + 1);

  async function toggleTask(task: Task) {
    if (toggling.current) return;
    toggling.current = true; setBusyTask(task.id); setMessage(null);
    try {
      const result = task.status === 'COMPLETED' ? await planner.reopenTask(task) : await planner.completeTask(task);
      if (result.status === 'FAILED') setMessage(result.message);
      else if (result.warnings.length) setMessage(result.warnings.join(' '));
    } catch {
      setMessage('처리를 확인하지 못했어요. 목록을 확인해 주세요');
    } finally { toggling.current = false; setBusyTask(null); reload(); }
  }

  const move = (direction: -1 | 1) => setSelected(view === 'month' ? shiftMonth(selected, direction) : addDays(selected, direction * 7));
  const [year, month] = selected.split('-').map(Number);
  const title = view === 'month' ? monthTitle(selected) : weekTitle(selected);
  const day: CalendarDay = index ? dayOrEmpty(index, selected) : { date: selected, events: [], tasks: [] };

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.spread}>
          <Text style={styles.title} accessibilityRole="header">캘린더</Text>
          <View style={styles.row}>
            {selected !== today && (
              <Pressable accessibilityRole="button" accessibilityLabel="오늘로 이동" onPress={() => setSelected(today)} style={styles.linkButton}>
                <Text style={styles.linkText}>오늘</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${dateLabel(selected)}에 새로 적기`}
              onPress={() => router.push({ pathname: '/entry-form', params: { date: selected } })}
              style={[styles.button, { paddingHorizontal: s.space(Spacing.three) }]}>
              <Text style={styles.buttonText}>+ 새로 적기</Text>
            </Pressable>
          </View>
        </View>

        <SegmentControl<View_> label="보기 방식" options={VIEW_OPTIONS} value={view} onChange={setView} />

        <View style={styles.spread}>
          <Pressable accessibilityRole="button" accessibilityLabel={view === 'month' ? '이전 달' : '이전 주'} onPress={() => move(-1)} style={styles.linkButton}>
            <Text style={styles.linkText}>‹ 이전</Text>
          </Pressable>
          <Text style={styles.sectionTitle} accessibilityRole="header" accessibilityLiveRegion="polite">{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={view === 'month' ? '다음 달' : '다음 주'} onPress={() => move(1)} style={styles.linkButton}>
            <Text style={styles.linkText}>다음 ›</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: 'row' }}>
            {WEEKDAY_NAMES.map(name => (
              <View key={name} style={{ flex: 1, alignItems: 'center', paddingBottom: s.space(Spacing.one) }}>
                <Text style={[styles.hint, { fontWeight: '700' }]}>{name}</Text>
              </View>
            ))}
          </View>
          {(view === 'month' ? monthGrid(year, month) : [weekDates(selected)]).map(week => (
            <View key={week[0]} style={{ flexDirection: 'row' }}>
              {week.map(date => (
                <DayCell
                  key={date}
                  date={date}
                  inMonth={view === 'week' || date.startsWith(selected.slice(0, 7))}
                  isToday={date === today}
                  isSelected={date === selected}
                  day={index?.days.get(date)}
                  onPress={() => setSelected(date)}
                />
              ))}
            </View>
          ))}
          <Text style={styles.hint}>● 일정 · ■ 할 일</Text>
        </View>

        {status === 'error' ? (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.error}>일정을 불러오지 못했어요.</Text>
            <Pressable accessibilityRole="button" onPress={() => { setStatus('loading'); reload(); }} style={styles.secondary}>
              <Text style={styles.secondaryText}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : status === 'loading' && !index ? (
          <ActivityIndicator accessibilityLabel="일정 불러오는 중" />
        ) : (
          <View style={styles.field}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{dateLabel(selected)}{selected === today ? ' · 오늘' : ''}</Text>
            {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
            {day.events.length === 0 && day.tasks.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.heading}>이 날은 비어 있어요</Text>
                <Text style={styles.muted}>말하거나 직접 적어서 일정과 할 일을 넣어 보세요.</Text>
              </View>
            ) : (
              <View>
                {day.events.map(item => <EventRow key={item.event.id} item={item} />)}
                {day.tasks.map(task => <TaskRow key={task.id} task={task} timezone={timezone} busy={busyTask === task.id} onToggle={toggleTask} />)}
              </View>
            )}
          </View>
        )}

        {index && index.overdueTasks.length > 0 && (
          <View style={styles.field}>
            <Text style={styles.sectionTitle} accessibilityRole="header">마감이 지난 할 일 ({index.overdueTasks.length})</Text>
            {index.overdueTasks.map(task => <TaskRow key={task.id} task={task} timezone={timezone} overdue busy={busyTask === task.id} onToggle={toggleTask} />)}
          </View>
        )}
        {index && index.undatedTasks.length > 0 && (
          <View style={styles.field}>
            <Text style={styles.sectionTitle} accessibilityRole="header">날짜 없는 할 일 ({index.undatedTasks.length})</Text>
            {index.undatedTasks.map(task => <TaskRow key={task.id} task={task} timezone={timezone} busy={busyTask === task.id} onToggle={toggleTask} />)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One day of the grid: the number, and a dot for events and a square for tasks (at most three marks). */
function DayCell({ date, inMonth, isToday, isSelected, day, onPress }: {
  date: LocalDate; inMonth: boolean; isToday: boolean; isSelected: boolean; day: CalendarDay | undefined; onPress(): void;
}) {
  const s = useScaler();
  const eventCount = day?.events.length ?? 0;
  const taskCount = day?.tasks.length ?? 0;
  const dayNumber = Number(date.slice(8));
  const marks = [
    ...Array.from({ length: Math.min(eventCount, 2) }, () => 'event' as const),
    ...Array.from({ length: Math.min(taskCount, 3 - Math.min(eventCount, 2)) }, () => 'task' as const),
  ];
  const mark = s.space(7);
  const summary = [eventCount ? `일정 ${eventCount}개` : '', taskCount ? `할 일 ${taskCount}개` : ''].filter(Boolean).join(', ') || '비어 있음';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dateLabel(date)}${isToday ? ' 오늘' : ''}, ${summary}`}
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={{
        flex: 1, minHeight: s.touch + s.space(Spacing.two), alignItems: 'center', justifyContent: 'flex-start', paddingTop: s.space(Spacing.one),
        borderRadius: Radius.sm, borderWidth: 2, borderColor: isSelected ? palette.primary : 'transparent',
        backgroundColor: isSelected ? palette.nowFill : 'transparent',
      }}>
      <Text style={{
        fontSize: s.font(15), color: inMonth ? palette.ink : palette.muted, fontWeight: isToday ? '700' : '500',
        textDecorationLine: isToday ? 'underline' : 'none', opacity: inMonth ? 1 : 0.55,
      }}>{dayNumber}</Text>
      <View style={{ flexDirection: 'row', gap: s.space(Spacing.half), marginTop: s.space(Spacing.half), minHeight: mark }}>
        {marks.map((kind, position) => (
          <View
            key={`${kind}-${position}`}
            style={{ width: mark, height: mark, borderRadius: kind === 'event' ? mark : 2, backgroundColor: palette.primary }}
          />
        ))}
      </View>
    </Pressable>
  );
}
