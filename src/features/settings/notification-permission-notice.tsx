import { Pressable, Text, View } from 'react-native';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useNotifications } from './notification-context';

/** Settings > notifications: when the device blocks notifications the app says so and opens the system settings (blueprint 3.2). */
export function NotificationPermissionNotice() {
  const styles = useExpenseStyles();
  const { permission, requestPermission, openSystemSettings } = useNotifications();
  if (permission === 'GRANTED') return <Text style={styles.hint}>기기의 알림이 켜져 있어요.</Text>;
  if (permission === 'BLOCKED') {
    return (
      <View accessibilityRole="alert" style={styles.banner}>
        <Text style={[styles.bannerText, { fontWeight: '700' }]}>알림 꺼짐</Text>
        <Text style={styles.bannerText}>기기의 알림 권한이 꺼져 있어서 알림이 울리지 않아요.</Text>
        <Pressable accessibilityRole="button" onPress={openSystemSettings} style={styles.linkButton}>
          <Text style={styles.linkText}>설정 열기</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>알림을 아직 허용하지 않았어요.</Text>
      <Pressable accessibilityRole="button" onPress={() => { void requestPermission(); }} style={styles.linkButton}>
        <Text style={styles.linkText}>알림 허용하기</Text>
      </Pressable>
    </View>
  );
}
