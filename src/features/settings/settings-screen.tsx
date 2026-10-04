import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { NotificationPermissionNotice } from './notification-permission-notice';
import { useSettings } from './settings-context';
import { useIsLoggedIn } from './use-is-logged-in';

/** T1: settings. Sections are added by later units (notifications, font size, my data); login-only sections arrive in M2. */
export function SettingsScreen() {
  const styles = useExpenseStyles();
  const loggedIn = useIsLoggedIn();
  const { settings, scaler } = useSettings();
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '설정' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {!loggedIn && (
          <View style={styles.card}>
            <Text style={styles.text}>로그인하면 앱을 지워도 기록이 안전하고, 친구와 일정을 주고받을 수 있어요.</Text>
          </View>
        )}
        <View style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">알림</Text>
          <NotificationPermissionNotice />
        </View>
        <View style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">화면</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`글자 크기 ${settings.followSystemFont ? '시스템 설정을 따름' : `${Math.round(settings.fontScale * 100)}%`}, 바꾸기`} onPress={() => router.push('/font-size')} style={styles.secondary}>
            <Text style={styles.secondaryText}>글자 크기 · {settings.followSystemFont ? '시스템 설정' : `${Math.round(scaler.scale * 100)}%`}</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">내 데이터</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/export')} style={styles.secondary}>
            <Text style={styles.secondaryText}>엑셀로 내보내기</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">AI</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/ai-settings')} style={styles.secondary}>
            <Text style={styles.secondaryText}>AI 연결 설정</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">정보</Text>
          <Text style={styles.muted}>앱 버전 {Constants.expoConfig?.version ?? '알 수 없음'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
