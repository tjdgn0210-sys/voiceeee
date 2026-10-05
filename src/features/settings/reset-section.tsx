import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../../components/bottom-sheet';
import { isResetConfirmed, RESET_CONFIRM_WORD, SETTINGS_AFTER_RESET } from '../../application/reset/local-data-reset';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { SettingGroup, SettingPanel, SettingRow } from './setting-parts';
import { useLocalDataReset } from './reset-context';
import { useSettings } from './settings-context';

const WILL_BE_DELETED = ['일정과 할 일', '지출 기록', '예약된 알림', '앱 설정(글자 크기 · 알림)'] as const;

/**
 * Reset "(c)" (design `#dangerSheet`): delete every record on this phone. A guest has no server backup, so this is all there is
 * (blueprint 3.7). Two steps in a bottom sheet: first what will be deleted, then the word "삭제" must be typed before the red
 * button works.
 */
export function ResetSection() {
  const styles = useExpenseStyles();
  const reset = useLocalDataReset();
  const { update } = useSettings();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [word, setWord] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busy = useRef(false);

  const close = () => { if (!busy.current) { setOpen(false); setStep(1); setWord(''); } };

  async function confirm() {
    if (busy.current || !isResetConfirmed(word)) return;
    busy.current = true; setWorking(true); setMessage(null);
    try {
      const result = await reset.reset(word);
      if (result.status === 'FAILED') setMessage(result.message);
      if (result.status === 'DONE' || (result.status === 'FAILED' && result.message.startsWith('기록은 지웠지만'))) {
        // The records are gone either way: the screens must show defaults at once.
        await update(SETTINGS_AFTER_RESET);
        setOpen(false); setStep(1); setWord(''); setDone(result.status === 'DONE');
      }
    } catch {
      setMessage('지우지 못했어요. 기록은 그대로 있어요. 다시 시도해 주세요');
    } finally { busy.current = false; setWorking(false); }
  }

  return (
    <SettingGroup label="초기화">
      <SettingPanel>
        <SettingRow
          last
          danger
          title="모든 기록 지우기"
          hint="이 기기의 일정, 할 일, 지출, 알림, 설정을 모두 지워요."
          onPress={() => { setOpen(true); setStep(1); setDone(false); setMessage(null); }}
        />
      </SettingPanel>
      {done && <View accessibilityLiveRegion="polite" style={styles.notice}><Text style={styles.noticeText}>이 기기의 모든 기록을 지웠어요.</Text></View>}
      {!!message && !open && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}

      <BottomSheet visible={open} title="정말 모든 기록을 지울까요?" onClose={close}>
        {step === 1 ? (
          <>
            <Text style={styles.text}>아래 기록이 이 기기에서 지워져요. 로그인하지 않았으므로 백업이 없어서 되돌릴 수 없어요.</Text>
            <View style={styles.field}>
              {WILL_BE_DELETED.map(item => <Text key={item} style={styles.text}>• {item}</Text>)}
            </View>
            <Pressable accessibilityRole="button" onPress={() => setStep(2)} style={[styles.button, styles.dangerButton]}>
              <Text style={[styles.buttonText, styles.dangerButtonText]}>계속</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={close} style={styles.secondary}>
              <Text style={styles.secondaryText}>취소</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.text}>계속하려면 “{RESET_CONFIRM_WORD}”를 입력해 주세요</Text>
            <TextInput
              accessibilityLabel={`확인을 위해 ${RESET_CONFIRM_WORD} 입력`}
              value={word}
              onChangeText={setWord}
              editable={!working}
              autoCapitalize="none"
              placeholder={RESET_CONFIRM_WORD}
              placeholderTextColor={palette.placeholder}
              style={styles.input}
            />
            {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: working || !isResetConfirmed(word), busy: working }}
              disabled={working || !isResetConfirmed(word)}
              onPress={confirm}
              style={[styles.button, styles.dangerButton, (working || !isResetConfirmed(word)) && styles.disabled]}>
              <Text style={[styles.buttonText, styles.dangerButtonText]}>{working ? '지우는 중…' : '모든 기록 지우기'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={working} onPress={() => { setStep(1); setWord(''); setMessage(null); }} style={styles.linkButton}>
              <Text style={styles.linkText}>이전</Text>
            </Pressable>
          </>
        )}
      </BottomSheet>
    </SettingGroup>
  );
}
