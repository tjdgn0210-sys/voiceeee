import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { monthBounds, monthOf, shiftYearMonth, summarizeMonth } from '../../application/expenses/expense-summary';
import { localDateIn } from '../../application/validator/local-date';
import type { Transaction } from '../../domain/transaction/transaction';
import { usePlanner } from '../calendar/planner-context';
import { useExpenses } from '../capture/expense-context';
import { useExpenseStyles } from '../capture/use-expense-styles';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** E1: month total, totals by category, and the month's list. Records kept out of the total stay in the list and say so. */
export function ExpensesScreen() {
  const expenses = useExpenses();
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const timezone = planner.timezone();
  const currentMonth = monthOf(localDateIn(timezone, planner.now()));
  const [month, setMonth] = useState(currentMonth);
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(false);
      try {
        const bounds = monthBounds(month, timezone);
        const records = await expenses.between(bounds.from, bounds.until);
        if (active) setItems(records);
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    }
    void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; subscription.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicit invalidation key reloads committed local data.
  }, [expenses, month, timezone, attempt]));

  const summary = useMemo(() => summarizeMonth(items), [items]);
  const [year, number] = month.split('-').map(Number);

  return <SafeAreaView style={styles.screen} edges={['left', 'right']}>
    <FlatList data={items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.formStack}>
        <View style={styles.spread}>
          <Pressable accessibilityRole="button" accessibilityLabel="이전 달" onPress={() => setMonth(shiftYearMonth(month, -1))} style={styles.linkButton}><Text style={styles.linkText}>‹ 이전</Text></Pressable>
          <Text style={styles.sectionTitle} accessibilityRole="header" accessibilityLiveRegion="polite">{year}년 {number}월</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="다음 달" onPress={() => setMonth(shiftYearMonth(month, 1))} style={styles.linkButton}><Text style={styles.linkText}>다음 ›</Text></Pressable>
        </View>
        {month !== currentMonth && (
          <Pressable accessibilityRole="button" onPress={() => setMonth(currentMonth)} style={styles.secondary}><Text style={styles.secondaryText}>이번 달로 이동</Text></Pressable>
        )}

        <View style={styles.softCard}>
          <Text style={styles.muted}>{number}월 원화 지출 합계</Text>
          <Text style={styles.amount}>{error ? '확인 필요' : loading && items.length === 0 ? '—' : won(summary.total)}</Text>
          <Text style={styles.muted}>{error ? '기록을 확인하고 있습니다.' : `${summary.count}건 · 기기 현지 날짜 기준`}</Text>
          {summary.excludedCount > 0 && <Text style={styles.hint}>합계에서 제외한 기록 {summary.excludedCount}건은 목록에만 보여요.</Text>}
        </View>

        {summary.byCategory.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.heading} accessibilityRole="header">카테고리별</Text>
            {summary.byCategory.map(entry => (
              <View key={entry.category} accessible accessibilityLabel={`${entry.category} ${entry.count}건 ${won(entry.total)}`} style={styles.listRow}>
                <View style={styles.listBody}>
                  <Text style={styles.listTitle}>{entry.category}</Text>
                  <Text style={styles.listMeta}>{entry.count}건</Text>
                </View>
                <Text style={styles.recordAmount}>{won(entry.total)}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable accessibilityRole="button" onPress={() => router.push('/manual-expense')} style={styles.button}><Text style={styles.buttonText}>지출 직접 입력</Text></Pressable>
        <View style={styles.field}><Text style={styles.heading} accessibilityRole="header">기록</Text><Text style={styles.muted}>기록을 누르면 상세 확인과 수정이 가능합니다.</Text></View>
        {loading && <ActivityIndicator accessibilityLabel="지출 불러오는 중" />}
        {error && <View style={styles.field}><Text accessibilityRole="alert" style={styles.error}>최신 기록을 불러오지 못했습니다.</Text><Pressable accessibilityRole="button" onPress={refresh} style={styles.secondary}><Text style={styles.secondaryText}>다시 불러오기</Text></Pressable></View>}
      </View>}
      ListEmptyComponent={!loading && !error ? <View style={styles.softCard}><Text style={styles.heading}>{number}월에는 기록이 없어요.</Text><Text style={styles.muted}>홈에서 말하거나 직접 입력한 지출을 여기에서 확인할 수 있습니다.</Text></View> : null}
      renderItem={({ item }) => <ExpenseRow item={item} />} />
  </SafeAreaView>;
}

export function ExpenseRow({ item }: { item: Transaction }) {
  const styles = useExpenseStyles();
  const typeText = item.type === 'INCOME' ? '수입' : '지출';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${typeText} ${item.category ?? '미분류'} ${item.amount.toLocaleString('ko-KR')}원${item.includeInTotal ? '' : ', 합계에서 제외'}, 상세 보기`}
    onPress={() => router.push({ pathname: '/expense', params: { id: item.id } })} style={({ pressed }) => [styles.record, pressed && styles.pressed]}>
    <View style={styles.row}><Text style={styles.heading}>{item.category ?? '미분류'}</Text><Text style={styles.recordAmount}>{item.type === 'INCOME' ? '+' : ''}{item.amount.toLocaleString('ko-KR')}{item.currencyCode === 'KRW' ? '원' : ` ${item.currencyCode}`}</Text></View>
    <Text style={styles.text} numberOfLines={2}>{item.memo ?? '메모 없음'}</Text>
    <Text style={styles.muted}>{new Date(item.occurredAt).toLocaleString('ko-KR')} · {item.inputMethod === 'VOICE' ? '음성' : item.inputMethod === 'TEXT' ? '문장' : '직접 입력'}</Text>
    {!item.includeInTotal && <View style={styles.badge}><Text style={styles.badgeText}>합계에서 제외</Text></View>}
  </Pressable>;
}
