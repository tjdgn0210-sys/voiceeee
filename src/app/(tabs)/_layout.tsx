import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, Text } from 'react-native';
import { AppTabBar } from '@/components/app-tab-bar';
import { Radius } from '@/constants/theme';
import { palette } from '@/features/capture/expense-styles';
import { useScaler } from '@/features/settings/settings-context';

/** The only button in the header (design `.settingsButton`): a thin-lined pill. */
function SettingsButton() {
  const s = useScaler();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="설정"
      onPress={() => router.push('/settings')}
      style={{
        minHeight: s.touch, justifyContent: 'center', alignItems: 'center', paddingHorizontal: s.space(18), marginRight: s.space(16),
        borderWidth: 1, borderColor: palette.line, borderRadius: Radius.pill,
      }}>
      <Text style={{ color: palette.ink, fontSize: s.font(14), fontWeight: '600' }}>설정</Text>
    </Pressable>
  );
}

/** The four tabs. The header has the colour of the screen (no line) and only the settings button on the right. */
export default function TabsLayout() {
  const s = useScaler();
  return (
    <Tabs
      tabBar={props => <AppTabBar {...props} />}
      screenOptions={{
        headerRight: () => <SettingsButton />,
        headerTitleAlign: 'left',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: palette.canvas },
        headerTitleStyle: { fontSize: s.font(15), fontWeight: '600', letterSpacing: 0.3, color: palette.ink },
        sceneStyle: { backgroundColor: palette.canvas },
      }}>
      <Tabs.Screen name="index" options={{ title: '홈' }} />
      <Tabs.Screen name="calendar" options={{ title: '캘린더' }} />
      <Tabs.Screen name="expenses" options={{ title: '지출' }} />
      <Tabs.Screen name="people" options={{ title: '사람' }} />
    </Tabs>
  );
}
