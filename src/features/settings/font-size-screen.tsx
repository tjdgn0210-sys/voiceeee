import { useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  clampFontScale, createScaler, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, fontScaleSteps,
} from '../../utils/font-scale';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { SwitchRow } from '../calendar/form-controls';
import { useSettings } from './settings-context';
import { StepSlider } from './step-slider';

const STEPS = fontScaleSteps();
export const percentLabel = (scale: number) => `${Math.round(scale * 100)}%`;

/** T5: font size 70-200% in 14 steps, a slider with [−] [+], a live preview, [기본값으로] and "follow the system". */
export function FontSizeScreen() {
  const styles = useExpenseStyles();
  const { settings, update, systemFontScale, scaler } = useSettings();
  const [preview, setPreview] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const shown = preview ?? (settings.followSystemFont ? clampFontScale(systemFontScale) : settings.fontScale);
  const sample = createScaler(shown);

  async function save(patch: Parameters<typeof update>[0]) {
    if (busy.current) return;
    busy.current = true; setMessage(null);
    try { await update(patch); }
    catch { setMessage('저장하지 못했어요. 다시 시도해 주세요'); }
    finally { busy.current = false; setPreview(null); }
  }
  const step = (delta: number) => save({ fontScale: clampFontScale(settings.fontScale + delta * FONT_SCALE_STEP) });
  const locked = settings.followSystemFont;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '글자 크기' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">글자 크기 {percentLabel(shown)}</Text>
          <View style={[styles.row, { flexWrap: 'nowrap' }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="글자 작게"
              accessibilityState={{ disabled: locked || settings.fontScale <= FONT_SCALE_MIN }}
              disabled={locked || settings.fontScale <= FONT_SCALE_MIN}
              onPress={() => step(-1)}
              style={[styles.secondary, { minWidth: scaler.touch }, (locked || settings.fontScale <= FONT_SCALE_MIN) && styles.disabled]}>
              <Text style={styles.secondaryText}>−</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <StepSlider
                label="글자 크기"
                steps={STEPS}
                value={shown}
                disabled={locked}
                format={percentLabel}
                onPreview={setPreview}
                onChangeEnd={value => { void save({ fontScale: value }); }}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="글자 크게"
              accessibilityState={{ disabled: locked || settings.fontScale >= FONT_SCALE_MAX }}
              disabled={locked || settings.fontScale >= FONT_SCALE_MAX}
              onPress={() => step(1)}
              style={[styles.secondary, { minWidth: scaler.touch }, (locked || settings.fontScale >= FONT_SCALE_MAX) && styles.disabled]}>
              <Text style={styles.secondaryText}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>{percentLabel(FONT_SCALE_MIN)}부터 {percentLabel(FONT_SCALE_MAX)}까지 10% 단위로 고를 수 있어요.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>미리보기</Text>
          <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: sample.space(16), gap: sample.space(8), backgroundColor: palette.canvas }}>
            <Text style={{ fontSize: sample.font(19), fontWeight: '700', color: palette.ink }}>오늘 일정</Text>
            <Text style={{ fontSize: sample.font(16), lineHeight: sample.line(16), color: palette.ink }}>오후 7:00 친구랑 저녁 약속</Text>
            <Text style={{ fontSize: sample.font(14), color: palette.muted }}>점심 7,000원을 저장했어요</Text>
          </View>
        </View>

        <View style={styles.card}>
          <SwitchRow
            title="시스템 글자 크기 따르기"
            hint={locked ? `기기 설정의 ${percentLabel(clampFontScale(systemFontScale))}를 그대로 써요` : '켜면 기기 설정의 글자 크기를 써요'}
            value={locked}
            onChange={value => { void save({ followSystemFont: value }); }}
          />
        </View>

        {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: settings.fontScale === FONT_SCALE_DEFAULT && !locked }}
          disabled={settings.fontScale === FONT_SCALE_DEFAULT && !locked}
          onPress={() => { void save({ fontScale: FONT_SCALE_DEFAULT, followSystemFont: false }); }}
          style={[styles.secondary, settings.fontScale === FONT_SCALE_DEFAULT && !locked && styles.disabled]}>
          <Text style={styles.secondaryText}>기본값으로</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
