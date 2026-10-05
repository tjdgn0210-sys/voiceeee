import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenIntro } from '../../components/screen-intro';
import { dayOrEmpty, indexCalendar, type CalendarDay } from '../../application/planner/calendar-model';
import { addDays } from '../../application/planner/zoned-time';
import { localDateIn } from '../../application/validator/local-date';
import type { Transaction } from '../../domain/transaction/transaction';
import { EventRow } from '../calendar/event-row';
import { usePlanner } from '../calendar/planner-context';
import { CaptureComposer } from '../capture/capture-composer';
import { useExpenses } from '../capture/expense-context';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { ExpenseRow } from '../money/expenses-screen';
import { useIsLoggedIn } from '../settings/use-is-logged-in';

const TODAY_EVENT_LIMIT = 4;
const RECENT_EXPENSE_LIMIT = 3;

/** H1 (design #homeScreen): head, today's total, quick record, today's events, recent records, and the guest notice. */
export function HomeScreen() {
  const expenses = useExpenses();
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const loggedIn = useIsLoggedIn();
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<{ total: number; count: number } | null>(null);
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
        const start = new Date(expenses.now()); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        const [records, range, totals] = await Promise.all([
          expenses.history(RECENT_EXPENSE_LIMIT), planner.loadRange(date, addDays(date, 1)), expenses.summary(start.toISOString(), end.toISOString()),
        ]);
        if (!active) return;
        setRecent(records);
        setSummary(totals);
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
      <ScreenIntro eyebrow="VOICE LIFE MANAGER" title="오늘의 지출" description="기록은 이 기기에 보관됩니다." />
      {!loggedIn && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>백업 꺼짐 · 로그인하면 앱을 지워도 기록이 안전해요</Text>
        </View>
      )}

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>오늘 발생한 원화 지출</Text>
        <Text accessibilityLabel={error ? '오늘 지출 확인 필요' : summary ? `오늘 지출 ${summary.total.toLocaleString('ko-KR')}원` : '오늘 지출 확인 중'}>
          <Text style={styles.heroNumber}>{error ? '확인 필요' : summary ? summary.total.toLocaleString('ko-KR') : '—'}</Text>
          {summary && !error ? <Text style={styles.heroUnit}> 원</Text> : null}
        </Text>
        <Text style={styles.heroCaption}>{summary && !error ? `${summary.count}건 · 기기 현지 날짜 기준` : '기록을 확인하고 있습니다.'}</Text>
      </View>

      <CaptureComposer onSaved={refresh} />

      <View style={styles.card}>
        <View style={styles.spread}>
          <Text style={styles.sectionTitle} accessibilityRole="header">오늘 일정</Text>
          <Pressable accessibilityRole="button" onPress={() => router.navigate('/calendar')} style={styles.linkButton}><Text style={styles.linkText}>캘린더 보기</Text></Pressable>
        </View>
        {loading && !today && <ActivityIndicator accessibilityLabel="오늘 일정 불러오는 중" color={palette.primary} />}
        {today && shown.length === 0 && <Text style={styles.muted}>오늘은 일정이 없어요.</Text>}
        <View>{shown.map(item => <EventRow key={item.event.id} item={item} />)}</View>
        {hidden > 0 && <Text style={styles.muted}>그 밖에 일정 {hidden}개가 더 있어요.</Text>}
        {!!today?.tasks.length && <Text style={styles.muted}>오늘 마감 할 일 {today.tasks.length}개 · 캘린더에서 확인해요.</Text>}
      </View>

      <View style={{ gap: 6, paddingTop: 12 }}>
        <Text style={styles.sectionTitle} accessibilityRole="header">최근 기록</Text>
        <Text style={styles.muted}>기록을 누르면 상세 확인과 수정이 가능합니다.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.navigate('/expenses')} style={styles.linkButton}><Text style={styles.linkText}>지출 모두 보기</Text></Pressable>
      </View>
      {error && <View style={styles.field}><Text accessibilityRole="alert" style={styles.error}>최신 기록을 불러오지 못했습니다.</Text><Pressable accessibilityRole="button" onPress={refresh} style={styles.secondary}><Text style={styles.secondaryText}>다시 불러오기</Text></Pressable></View>}
      {!loading && !error && recent.length === 0 && (
        <View style={styles.card}><Text style={styles.heading}>첫 기록을 남겨 보세요.</Text><Text style={styles.muted}>말하거나 직접 입력한 지출을 여기에서 확인할 수 있습니다.</Text></View>
      )}
      <View>{recent.map(item => <ExpenseRow key={item.id} item={item} />)}</View>
    </ScrollView>
  </SafeAreaView>;
}
