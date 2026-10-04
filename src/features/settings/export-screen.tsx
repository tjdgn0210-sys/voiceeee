import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ExportKind, ExportOptions, ExportPeriod } from '../../application/export/export-model';
import type { ExportPreview } from '../../application/export/export-service';
import { PickerField } from '../calendar/picker-field';
import { SegmentControl } from '../calendar/form-controls';
import { usePlanner } from '../calendar/planner-context';
import { addDays } from '../../application/planner/zoned-time';
import { localDateIn } from '../../application/validator/local-date';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useExport } from './export-context';

type PeriodChoice = 'ALL' | 'THIS_MONTH' | 'RANGE';

const PERIOD_OPTIONS: readonly { value: PeriodChoice; label: string }[] = [
  { value: 'ALL', label: '전체' }, { value: 'THIS_MONTH', label: '이번 달' }, { value: 'RANGE', label: '직접 선택' },
];
const KIND_OPTIONS: readonly { value: ExportKind; label: string }[] = [
  { value: 'EXPENSE', label: '지출' }, { value: 'EVENT', label: '일정' }, { value: 'BOTH', label: '둘 다' },
];

/** T6: Excel export. Works offline and without login; nothing is sent to a server. */
export function ExportScreen() {
  const styles = useExpenseStyles();
  const service = useExport();
  const planner = usePlanner();
  const today = localDateIn(planner.timezone(), planner.now());
  const [choice, setChoice] = useState<PeriodChoice>('THIS_MONTH');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<ExportKind>('BOTH');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = useRef(false);

  const period: ExportPeriod = choice === 'RANGE' ? { kind: 'RANGE', from, to } : { kind: choice };
  const options: ExportOptions = { period, kind };

  useEffect(() => {
    let active = true;
    service.preview({ period: choice === 'RANGE' ? { kind: 'RANGE', from, to } : { kind: choice }, kind })
      .then(value => { if (active) { setPreview(value); setPreviewFailed(false); } })
      .catch(() => { if (active) { setPreview(null); setPreviewFailed(true); } });
    return () => { active = false; };
  }, [service, choice, from, to, kind]);

  const count = preview?.status === 'OK'
    ? (kind !== 'EVENT' ? preview.expenseCount : 0) + (kind !== 'EXPENSE' ? preview.eventCount : 0)
    : 0;
  const empty = preview?.status === 'OK' && count === 0;
  const blocked = working || !preview || preview.status !== 'OK' || count === 0;

  async function create() {
    if (busy.current || blocked) return;
    busy.current = true; setWorking(true); setDone(null); setFailure(null);
    try {
      const outcome = await service.create(options);
      if (outcome.status === 'DONE') setDone(`${outcome.fileName} 파일을 만들었어요. (지출 ${kind !== 'EVENT' ? outcome.expenseCount : 0}건 · 일정 ${kind !== 'EXPENSE' ? outcome.eventCount : 0}건)`);
      else if (outcome.status === 'FAILED') setFailure(outcome.message);
      else if (outcome.status === 'INVALID_PERIOD') setFailure(outcome.message);
    } catch {
      setFailure('파일을 만들지 못했어요. 기간을 줄여서 다시 시도해 주세요');
    } finally { busy.current = false; setWorking(false); }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '엑셀로 내보내기' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.fieldLabel} accessibilityRole="header">기간</Text>
          <SegmentControl<PeriodChoice> label="기간" options={PERIOD_OPTIONS} value={choice} onChange={value => { setChoice(value); setDone(null); setFailure(null); }} />
          {choice === 'RANGE' && (
            <View style={styles.row}>
              <PickerField kind="date" label="시작하는 날" value={from} onChange={value => { setFrom(value); setDone(null); }} />
              <PickerField kind="date" label="끝나는 날" value={to} onChange={value => { setTo(value); setDone(null); }} />
            </View>
          )}
          <Text style={styles.fieldLabel} accessibilityRole="header">내보낼 기록</Text>
          <SegmentControl<ExportKind> label="내보낼 기록" options={KIND_OPTIONS} value={kind} onChange={value => { setKind(value); setDone(null); setFailure(null); }} />
        </View>

        <View style={styles.card} accessibilityLiveRegion="polite">
          {preview === null && !previewFailed && <ActivityIndicator accessibilityLabel="기록 개수 세는 중" />}
          {previewFailed && <Text accessibilityRole="alert" style={styles.error}>기록을 확인하지 못했어요. 기간을 바꿔 보세요.</Text>}
          {preview?.status === 'INVALID_PERIOD' && <Text accessibilityRole="alert" style={styles.error}>{preview.message}</Text>}
          {preview?.status === 'OK' && (
            <Text style={styles.text}>
              {kind !== 'EVENT' ? `지출 ${preview.expenseCount}건` : ''}{kind === 'BOTH' ? ' · ' : ''}{kind !== 'EXPENSE' ? `일정 ${preview.eventCount}건` : ''}
            </Text>
          )}
          {empty && <Text style={styles.muted}>선택한 기간에 내보낼 기록이 없어요. 기간이나 종류를 바꿔 보세요.</Text>}
          <Text style={styles.hint}>파일은 이 기기에서만 만들어져요. 삭제한 기록은 들어가지 않고, 시간은 기기 시간대로 적혀요.</Text>
        </View>

        {!!failure && (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.error}>{failure}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setChoice('THIS_MONTH'); setFailure(null); }} style={styles.secondary}>
              <Text style={styles.secondaryText}>기간을 이번 달로 줄이기</Text>
            </Pressable>
          </View>
        )}
        {!!done && (
          <View accessibilityLiveRegion="polite" style={styles.okBanner}>
            <Text style={styles.okBannerText}>{done}</Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked, busy: working }}
          disabled={blocked}
          onPress={create}
          style={[styles.button, blocked && styles.disabled]}>
          <Text style={styles.buttonText}>{working ? '파일 만드는 중…' : '엑셀 파일 만들기'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
