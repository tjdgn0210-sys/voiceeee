import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { dayOrEmpty, indexCalendar, type CalendarDay } from '../../application/planner/calendar-model';
import { addDays } from '../../application/planner/zoned-time';
import { localDateIn } from '../../application/validator/local-date';
import type { Transaction } from '../../domain/transaction/transaction';
import { EventRow } from '../calendar/event-row';
import { usePlanner } from '../calendar/planner-context';
import { CaptureComposer } from '../capture/capture-composer';
import { useExpenses } from '../capture/expense-context';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { ExpenseRow } from '../money/expenses-screen';
import { useIsLoggedIn } from '../settings/use-is-logged-in';
import { ExpenseUndoFeedback } from './expense-undo-feedback';

const TODAY_EVENT_LIMIT = 4;
const RECENT_EXPENSE_LIMIT = 3;

/** H1: quick record, today's events, recent expenses, and the guest banner. */
export function HomeScreen() {
  const expenses = useExpenses();
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const loggedIn = useIsLoggedIn();
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [today, setToday] = useState<CalendarDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(false);
      try {
        const timezone = planner.timezone();
        const date = localDateIn(timezone, planner.now());
        const [records, range] = await Promise.all([expenses.history(RECENT_EXPENSE_LIMIT), planner.loadRange(date, addDays(date, 1))]);
        if (!active) return;
        setRecent(records);
        setToday(dayOrEmpty(indexCalendar(range.events, range.tasks, planner.now(), timezone), date));
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    }
    void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; subscription.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicit invalidation key reloads committed local data.
  }, [expenses, planner, attempt]));

  const shown = today?.events.slice(0, TODAY_EVENT_LIMIT) ?? [];
  const hidden = (today?.events.length ?? 0) - shown.length;
  return <SafeAreaView style={styles.screen} edges={['left', 'right']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {!loggedIn && (
        <View style={styles.banner}>
          <Text style={[styles.bannerText, { fontWeight: '700' }]}>백업 꺼짐</Text>
          <Text style={styles.bannerText}>로그인하면 앱을 지워도 기록이 안전해요.</Text>
        </View>
      )}
      <ExpenseUndoFeedback refreshKey={attempt} onResult={refresh} />
      <CaptureComposer onSaved={refresh} />

      <View style={styles.field}>
        <View style={styles.spread}>
          <Text style={styles.heading} accessibilityRole="header">오늘 일정</Text>
          <Pressable accessibilityRole="button" onPress={() => router.navigate('/calendar')} style={styles.linkButton}><Text style={styles.linkText}>캘린더에서 보기</Text></Pressable>
        </View>
        {loading && !today && <ActivityIndicator accessibilityLabel="오늘 일정 불러오는 중" />}
        {error && <View style={styles.field}><Text accessibilityRole="alert" style={styles.error}>최신 기록을 불러오지 못했습니다.</Text><Pressable accessibilityRole="button" onPress={refresh} style={styles.secondary}><Text style={styles.secondaryText}>다시 불러오기</Text></Pressable></View>}
        {today && shown.length === 0 && <Text style={styles.muted}>오늘은 일정이 없어요.</Text>}
        {shown.map(item => <EventRow key={item.event.id} item={item} />)}
        {hidden > 0 && <Text style={styles.muted}>그 밖에 일정 {hidden}개가 더 있어요.</Text>}
        {!!today?.tasks.length && <Text style={styles.muted}>오늘 마감 할 일 {today.tasks.length}개 · 캘린더에서 확인해요.</Text>}
      </View>

      <View style={styles.field}>
        <View style={styles.spread}>
          <Text style={styles.heading} accessibilityRole="header">최근 지출</Text>
          <Pressable accessibilityRole="button" onPress={() => router.navigate('/expenses')} style={styles.linkButton}><Text style={styles.linkText}>지출에서 보기</Text></Pressable>
        </View>
        {!loading && !error && recent.length === 0 && <Text style={styles.muted}>첫 지출을 말하거나 직접 적어 보세요.</Text>}
        {recent.map(item => <ExpenseRow key={item.id} item={item} />)}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
