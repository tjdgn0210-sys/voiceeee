import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, Text } from 'react-native';
import { AppTabBar } from '@/components/app-tab-bar';
import { palette } from '@/features/capture/expense-styles';
import { useScaler } from '@/features/settings/settings-context';

function SettingsButton() {
  const s = useScaler();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="설정"
      onPress={() => router.push('/settings')}
      style={{ minHeight: s.touch, minWidth: s.touch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s.space(8) }}>
      <Text style={{ color: palette.primary, fontSize: s.font(15), fontWeight: '600' }}>설정</Text>
    </Pressable>
  );
}

/** The four tabs. Only the first screen of a tab has no back button; the settings button sits at the top right. */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={props => <AppTabBar {...props} />}
      screenOptions={{ headerRight: () => <SettingsButton />, headerTitleAlign: 'left' }}>
      <Tabs.Screen name="index" options={{ title: '홈' }} />
      <Tabs.Screen name="calendar" options={{ title: '캘린더' }} />
      <Tabs.Screen name="expenses" options={{ title: '지출' }} />
      <Tabs.Screen name="people" options={{ title: '사람' }} />
    </Tabs>
  );
}
