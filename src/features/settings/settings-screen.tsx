import { router, Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenIntro } from '../../components/screen-intro';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { AboutSection } from './about-section';
import { NotificationSettings } from './notification-settings';
import { ResetSection } from './reset-section';
import { SettingGroup, SettingPanel, SettingRow } from './setting-parts';
import { useSettings } from './settings-context';
import { useIsLoggedIn } from './use-is-logged-in';

/**
 * T1 (design `#settingsPage`): a head, then groups of rows inside coloured panels. Sections that need an account (profile,
 * subscription, sharing, friends, account) arrive with M2 and later; the colour-picking "화면 설정" is out of this scope.
 */
export function SettingsScreen() {
  const styles = useExpenseStyles();
  const loggedIn = useIsLoggedIn();
  const { settings, scaler } = useSettings();
  const fontValue = settings.followSystemFont ? '시스템 설정' : `${Math.round(scaler.scale * 100)}%`;
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '설정' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenIntro eyebrow="SETTINGS" title="설정" />
        {!loggedIn && (
          <View style={styles.requestCard}>
            <Text style={styles.heading} accessibilityRole="header">로그인하지 않았어요</Text>
            <Text style={styles.muted}>로그인하면 백업, 친구, AI 해석 체험을 쓸 수 있어요.</Text>
          </View>
        )}
        <NotificationSettings />
        <SettingGroup label="화면 · 연결">
          <SettingPanel>
            <SettingRow
              title="글자 크기"
              hint="70%~200% · 기기 설정 따르기"
              value={fontValue}
              accessibilityLabel={`글자 크기 ${settings.followSystemFont ? '시스템 설정을 따름' : `${Math.round(settings.fontScale * 100)}%`}, 바꾸기`}
              onPress={() => router.push('/font-size')}
            />
            <SettingRow last title="AI 연결" hint="복잡한 문장을 해석하는 AI 서버 연결" onPress={() => router.push('/ai-settings')} />
          </SettingPanel>
        </SettingGroup>
        <SettingGroup label="내보내기">
          <SettingPanel>
            <SettingRow last title="엑셀로 내보내기" hint="지출과 일정을 .xlsx 파일로 만들어요. 로그인하지 않아도 쓸 수 있어요." onPress={() => router.push('/export')} />
          </SettingPanel>
        </SettingGroup>
        <ResetSection />
        <AboutSection />
      </ScrollView>
    </SafeAreaView>
  );
}
