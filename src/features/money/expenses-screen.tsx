import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenIntro } from '../../components/screen-intro';
import { monthBounds, monthOf, shiftYearMonth, summarizeMonth } from '../../application/expenses/expense-summary';
import { localDateIn } from '../../application/validator/local-date';
import type { Transaction } from '../../domain/transaction/transaction';
import { usePlanner } from '../calendar/planner-context';
import { useExpenses } from '../capture/expense-context';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useScaler } from '../settings/settings-context';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** E1 (design #expensesPage): head, month card with the total, totals by category with bars, and the month's list. */
export function ExpensesScreen() {
  const expenses = useExpenses();
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const s = useScaler();
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
  const caption = error ? '기록을 확인하고 있습니다.' : [`${summary.count}건`, summary.excludedCount > 0 ? `합계 제외 ${summary.excludedCount}건` : null].filter(Boolean).join(' · ');

  return <SafeAreaView style={styles.screen} edges={['left', 'right']}>
    <FlatList data={items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={{ gap: s.space(28) }}>
        <ScreenIntro eyebrow="EXPENSES" title="지출" description="달마다 합계와 카테고리별 금액을 볼 수 있어요. 기록을 누르면 자세히 볼 수 있어요." />
        <View style={styles.card}>
          <View style={styles.calNav}>
            <Pressable accessibilityRole="button" accessibilityLabel="이전 달" onPress={() => setMonth(shiftYearMonth(month, -1))} style={styles.navButton}><Text accessible={false} style={styles.navText}>‹</Text></Pressable>
            <Text style={styles.calLabel} accessibilityRole="header" accessibilityLiveRegion="polite">{year}년 {number}월</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="다음 달" onPress={() => setMonth(shiftYearMonth(month, 1))} style={styles.navButton}><Text accessible={false} style={styles.navText}>›</Text></Pressable>
          </View>
          {month !== currentMonth && (
            <Pressable accessibilityRole="button" onPress={() => setMonth(currentMonth)} style={styles.linkButton}><Text style={styles.linkText}>이번 달로 이동</Text></Pressable>
          )}
          <Text style={styles.fieldLabel}>{number}월 원화 지출 합계</Text>
          <Text accessibilityLabel={error ? '합계 확인 필요' : `합계 ${won(summary.total)}`}>
            <Text style={styles.heroNumber}>{error ? '확인 필요' : loading && items.length === 0 ? '—' : summary.total.toLocaleString('ko-KR')}</Text>
            {!error ? <Text style={[styles.settingValue, { fontSize: s.font(18) }]}> 원</Text> : null}
          </Text>
          <Text style={styles.muted}>{caption}</Text>
        </View>

        {summary.byCategory.length > 0 && (
          <View style={styles.group}>
            <Text style={styles.groupLabel} accessibilityRole="header">카테고리별</Text>
            <View style={[styles.panel, styles.panelBlock]}>
              {summary.byCategory.map(entry => {
                const ratio = summary.total > 0 ? entry.total / summary.total : 0;
                const percent = Math.round(ratio * 100);
                const fill = Math.max(1, percent);
                return (
                  <View key={entry.category} accessible accessibilityLabel={`${entry.category} ${entry.count}건 ${won(entry.total)}, ${percent}%`} style={{ gap: s.space(8) }}>
                    <View style={styles.spread}>
                      <Text style={styles.text}>{entry.category}</Text>
                      <Text style={styles.text}>{won(entry.total)} · {percent}%</Text>
                    </View>
                    <View accessibilityElementsHidden importantForAccessibility="no" style={styles.meter}>
                      <View style={{ flexGrow: fill, backgroundColor: palette.primary, height: s.space(8) }} />
                      <View style={{ flexGrow: 100 - fill, height: s.space(8) }} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {!loading && !error && items.length === 0 && (
          <View style={styles.requestCard}>
            <Text style={styles.heading}>{number}월에는 지출이 없어요</Text>
            <Text style={styles.muted}>말하거나 직접 입력하면 여기에 쌓여요.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/manual-expense')} style={[styles.smallButton, { alignSelf: 'flex-start' }]}><Text style={styles.smallButtonText}>직접 입력</Text></Pressable>
          </View>
        )}
        {items.length > 0 && <Text style={styles.groupLabel} accessibilityRole="header">목록</Text>}
        {loading && <ActivityIndicator accessibilityLabel="지출 불러오는 중" color={palette.primary} />}
        {error && <View style={styles.field}><Text accessibilityRole="alert" style={styles.error}>최신 기록을 불러오지 못했습니다.</Text><Pressable accessibilityRole="button" onPress={refresh} style={styles.secondary}><Text style={styles.secondaryText}>다시 불러오기</Text></Pressable></View>}
      </View>}
      ListFooterComponent={<Pressable accessibilityRole="button" onPress={() => router.push('/manual-expense')} style={[styles.button, { marginTop: s.space(28) }]}><Text style={styles.buttonText}>새 지출 직접 입력</Text></Pressable>}
      renderItem={({ item }) => <ExpenseRow item={item} />} />
  </SafeAreaView>;
}

/** One record of a list (design .record): category and amount, memo, when and how, and a tag when it is kept out of the total. */
export function ExpenseRow({ item }: { item: Transaction }) {
  const styles = useExpenseStyles();
  const typeText = item.type === 'INCOME' ? '수입' : '지출';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${typeText} ${item.category ?? '미분류'} ${item.amount.toLocaleString('ko-KR')}원${item.includeInTotal ? '' : ', 합계에서 제외'}, 상세 보기`}
    onPress={() => router.push({ pathname: '/expense', params: { id: item.id } })} style={({ pressed }) => [styles.record, pressed && styles.pressed]}>
    <View style={styles.spread}><Text style={styles.recordTitle}>{item.category ?? '미분류'}</Text><Text style={styles.recordAmount}>{item.type === 'INCOME' ? '+' : ''}{item.amount.toLocaleString('ko-KR')}{item.currencyCode === 'KRW' ? '원' : ` ${item.currencyCode}`}</Text></View>
    <Text style={styles.text} numberOfLines={2}>{item.memo ?? '메모 없음'}</Text>
    <Text style={styles.muted}>{new Date(item.occurredAt).toLocaleString('ko-KR')} · {item.inputMethod === 'VOICE' ? '음성' : item.inputMethod === 'TEXT' ? '문장' : '직접 입력'}</Text>
    {!item.includeInTotal && <View style={styles.badge}><Text style={styles.badgeText}>합계 제외</Text></View>}
  </Pressable>;
}
