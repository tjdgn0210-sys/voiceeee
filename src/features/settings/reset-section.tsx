import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { isResetConfirmed, RESET_CONFIRM_WORD, SETTINGS_AFTER_RESET } from '../../application/reset/local-data-reset';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useLocalDataReset } from './reset-context';
import { useSettings } from './settings-context';

/**
 * Reset "(c)": delete every record on this phone. A guest has no server backup, so this is all there is (blueprint 3.7).
 * Two steps: the red button opens the confirmation, and the word "삭제" must be typed before the final button works.
 */
export function ResetSection() {
  const styles = useExpenseStyles();
  const reset = useLocalDataReset();
  const { update } = useSettings();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busy = useRef(false);

  async function confirm() {
    if (busy.current || !isResetConfirmed(word)) return;
    busy.current = true; setWorking(true); setMessage(null);
    try {
      const result = await reset.reset(word);
      if (result.status === 'FAILED') setMessage(result.message);
      if (result.status === 'DONE' || (result.status === 'FAILED' && result.message.startsWith('기록은 지웠지만'))) {
        // The records are gone either way: the screens must show defaults at once.
        await update(SETTINGS_AFTER_RESET);
        setOpen(false); setWord(''); setDone(result.status === 'DONE');
      }
    } catch {
      setMessage('지우지 못했어요. 기록은 그대로 있어요. 다시 시도해 주세요');
    } finally { busy.current = false; setWorking(false); }
  }

  return (
    <View style={styles.formStack}>
      {done && <View accessibilityLiveRegion="polite" style={styles.okBanner}><Text style={styles.okBannerText}>이 기기의 모든 기록을 지웠어요.</Text></View>}
      {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
      {!open ? (
        <Pressable accessibilityRole="button" onPress={() => { setOpen(true); setDone(false); setMessage(null); }} style={[styles.secondary, styles.danger]}>
          <Text style={styles.dangerText}>모든 기록 지우기</Text>
        </Pressable>
      ) : (
        <View style={[styles.card, styles.danger]}>
          <Text style={styles.heading} accessibilityRole="header">정말 모든 기록을 지울까요?</Text>
          <Text style={styles.text}>일정, 할 일, 지출, 알림, 설정이 이 기기에서 지워져요. 로그인하지 않았으므로 백업이 없어서 되돌릴 수 없어요.</Text>
          <Text style={styles.fieldLabel}>계속하려면 “{RESET_CONFIRM_WORD}”를 입력해 주세요</Text>
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
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: working || !isResetConfirmed(word), busy: working }}
            disabled={working || !isResetConfirmed(word)}
            onPress={confirm}
            style={[styles.secondary, styles.danger, (working || !isResetConfirmed(word)) && styles.disabled]}>
            <Text style={styles.dangerText}>{working ? '지우는 중…' : '모든 기록 지우기'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={working} onPress={() => { setOpen(false); setWord(''); }} style={styles.secondary}>
            <Text style={styles.secondaryText}>취소</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
