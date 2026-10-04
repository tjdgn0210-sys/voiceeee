import { Stack } from 'expo-router';
import { palette } from '../features/capture/expense-styles';
import { useScaler, useSettings } from '../features/settings/settings-context';

/** All routes. Until the first-run screens are done only /onboarding can be opened; afterwards it can not be reached again. */
export function RootStack() {
  const { settings } = useSettings();
  const s = useScaler();
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontSize: s.font(17), color: palette.ink } }}>
      <Stack.Protected guard={!settings.onboardingDone}>
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={settings.onboardingDone}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
        <Stack.Screen name="font-size" options={{ title: '글자 크기' }} />
        <Stack.Screen name="ai-settings" options={{ title: 'AI 연결 설정' }} />
        <Stack.Screen name="expense" options={{ title: '지출 상세' }} />
        <Stack.Screen name="manual-expense" options={{ title: '지출 직접 입력' }} />
        <Stack.Screen name="entry-form" options={{ title: '새로 적기' }} />
        <Stack.Screen name="event" options={{ title: '일정' }} />
      </Stack.Protected>
      <Stack.Protected guard={false}>
        <Stack.Screen name="explore" />
      </Stack.Protected>
    </Stack>
  );
}
