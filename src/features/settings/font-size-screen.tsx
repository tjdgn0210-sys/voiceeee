import { useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenIntro } from '../../components/screen-intro';
import {
  clampFontScale, createScaler, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, fontScaleSteps,
} from '../../utils/font-scale';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { SettingPanel, SettingSwitch } from './setting-parts';
import { useSettings } from './settings-context';
import { StepSlider } from './step-slider';

const STEPS = fontScaleSteps();
export const percentLabel = (scale: number) => `${Math.round(scale * 100)}%`;

/**
 * T5 (design `#fontPage`): font size 70-200% in 14 steps. A preview card, the big percent, [−] [slider] [+], the scale ends,
 * [기본값으로] and "follow the system".
 */
export function FontSizeScreen() {
  const styles = useExpenseStyles();
  const { settings, update, systemFontScale } = useSettings();
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
  const atDefault = settings.fontScale === FONT_SCALE_DEFAULT && !locked;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '글자 크기' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenIntro eyebrow="TEXT SIZE" title="글자 크기" description="70%부터 200%까지 10%씩 바꿀 수 있어요. 앱 안의 모든 글자가 함께 커지고 작아져요." />

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>미리보기</Text>
          <Text style={{ fontSize: sample.font(15), lineHeight: sample.font(24), color: palette.ink }}>점심 8천원 썼어. 내일 오후 3시에 병원 예약.</Text>
          <Text style={{ fontSize: sample.font(22), fontWeight: '500', color: palette.ink }}>12,900원</Text>
          <Text style={{ fontSize: sample.font(13), color: palette.muted }}>오늘 12:30 · 음성</Text>
        </View>

        <View style={styles.formStack}>
          <Text style={styles.fontPercent} accessibilityRole="header" accessibilityLiveRegion="polite">{percentLabel(shown)}</Text>
          <View style={styles.sliderRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="글자 작게"
              accessibilityState={{ disabled: locked || settings.fontScale <= FONT_SCALE_MIN }}
              disabled={locked || settings.fontScale <= FONT_SCALE_MIN}
              onPress={() => step(-1)}
              style={[styles.stepButton, (locked || settings.fontScale <= FONT_SCALE_MIN) && styles.disabled]}>
              <Text style={styles.stepButtonText}>−</Text>
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
              style={[styles.stepButton, (locked || settings.fontScale >= FONT_SCALE_MAX) && styles.disabled]}>
              <Text style={styles.stepButtonText}>+</Text>
            </Pressable>
          </View>
          <View style={styles.spread}>
            <Text style={styles.muted}>{percentLabel(FONT_SCALE_MIN)}</Text>
            <Text style={styles.muted}>100% (기본)</Text>
            <Text style={styles.muted}>{percentLabel(FONT_SCALE_MAX)}</Text>
          </View>
          {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: atDefault }}
            disabled={atDefault}
            onPress={() => { void save({ fontScale: FONT_SCALE_DEFAULT, followSystemFont: false }); }}
            style={[styles.secondary, atDefault && styles.disabled]}>
            <Text style={styles.secondaryText}>기본값으로</Text>
          </Pressable>
        </View>

        <SettingPanel>
          <SettingSwitch
            last
            title="시스템 글자 크기 따르기"
            hint={locked
              ? `켜면 기기 설정의 글자 크기만 따라가요. 지금 기기 설정은 ${percentLabel(clampFontScale(systemFontScale))}예요. 슬라이더는 쓸 수 없어요.`
              : '켜면 기기 설정의 글자 크기만 따라가요. 앱 크기와 곱하지 않고, 슬라이더는 쓸 수 없어요. 끄면 앱에서 정한 크기만 써요.'}
            value={locked}
            onChange={value => { void save({ followSystemFont: value }); }}
          />
        </SettingPanel>
        <Text style={styles.muted}>글자가 커지면 긴 숫자와 문장은 여러 줄로 나뉘어 보일 수 있어요.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
