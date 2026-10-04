import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useNotifications } from '../settings/notification-context';
import { useSettings } from '../settings/settings-context';

type Step = 'WELCOME' | 'NOTIFICATIONS' | 'START';

/**
 * First run (blueprint 3.2): O1 welcome → O2 why notifications are needed (before the system prompt, which iOS shows only once)
 * → O3 start. Login is added in M2, so the only way forward in O3 is to start without login.
 * The app works whatever the user answers to the notification prompt.
 */
export function OnboardingScreen() {
  const styles = useExpenseStyles();
  const { update } = useSettings();
  const notifications = useNotifications();
  const [step, setStep] = useState<Step>('WELCOME');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  async function guarded(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setWorking(true); setMessage(null);
    try { await action(); }
    catch { setMessage('처리하지 못했어요. 다시 눌러 주세요'); }
    finally { busy.current = false; setWorking(false); }
  }

  const ask = () => guarded(async () => {
    // The answer is not required: refusing, or an unavailable prompt, still moves on.
    await notifications.requestPermission().catch(() => 'UNDETERMINED');
    setStep('START');
  });
  const finish = () => guarded(async () => { await update({ onboardingDone: true }); });

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: 'center' }]}>
        {step === 'WELCOME' && (
          <View style={styles.softCard}>
            <Text style={styles.eyebrow}>VOICE LIFE MANAGER</Text>
            <Text style={styles.title} accessibilityRole="header">말하면 적어 드려요</Text>
            <Text style={styles.text}>약속, 할 일, 쓴 돈을 말하거나 적으면 한곳에 모아 두고 알려 드려요.</Text>
            <Text style={styles.muted}>기록은 이 기기에 저장돼요.</Text>
            <Pressable accessibilityRole="button" onPress={() => setStep('NOTIFICATIONS')} style={styles.button}>
              <Text style={styles.buttonText}>시작하기</Text>
            </Pressable>
          </View>
        )}
        {step === 'NOTIFICATIONS' && (
          <View style={styles.softCard}>
            <Text style={styles.title} accessibilityRole="header">알림이 필요해요</Text>
            <Text style={styles.text}>일정 시간과 친구가 보낸 일정을 알려 드리려면 알림이 필요해요.</Text>
            <Text style={styles.muted}>허용하지 않아도 앱은 쓸 수 있어요. 나중에 설정에서 바꿀 수 있어요.</Text>
            {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: working, busy: working }}
              disabled={working}
              onPress={ask}
              style={[styles.button, working && styles.disabled]}>
              <Text style={styles.buttonText}>{working ? '확인 중…' : '계속'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={working} onPress={() => setStep('START')} style={styles.secondary}>
              <Text style={styles.secondaryText}>나중에</Text>
            </Pressable>
          </View>
        )}
        {step === 'START' && (
          <View style={styles.softCard}>
            <Text style={styles.title} accessibilityRole="header">바로 시작해요</Text>
            <Text style={styles.text}>지금은 로그인 없이 시작해요. 기록은 이 기기에만 저장돼요.</Text>
            {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: working, busy: working }}
              disabled={working}
              onPress={finish}
              style={[styles.button, working && styles.disabled]}>
              <Text style={styles.buttonText}>{working ? '시작하는 중…' : '로그인 없이 시작'}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
