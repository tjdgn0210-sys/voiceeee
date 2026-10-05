import { Pressable, Text, View } from 'react-native';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useNotifications } from './notification-context';

/**
 * Settings > notifications > permission (design `.panelBlock` "알림 권한"): the device state as a value, and when the device blocks
 * notifications the app says so and opens the system settings (blueprint 3.2).
 */
export function NotificationPermissionNotice() {
  const styles = useExpenseStyles();
  const { permission, requestPermission, openSystemSettings } = useNotifications();
  const value = permission === 'GRANTED' ? '허용됨' : permission === 'BLOCKED' ? '꺼짐' : '아직 허용 안 함';
  return (
    <View style={[styles.panelBlock, styles.panelBlockLine]}>
      <View accessible accessibilityLabel={`알림 권한 ${value}`} style={styles.spread}>
        <Text style={styles.settingTitle}>알림 권한</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      {permission === 'BLOCKED' && (
        <View style={styles.field}>
          <Text accessibilityRole="alert" style={styles.settingHint}>기기의 알림 권한이 꺼져 있어요. 알림이 울리지 않고 일정 카드에 “알림 꺼짐”이 보여요.</Text>
          <Pressable accessibilityRole="button" onPress={openSystemSettings} style={styles.secondary}>
            <Text style={styles.secondaryText}>설정 열기</Text>
          </Pressable>
        </View>
      )}
      {permission === 'UNDETERMINED' && (
        <Pressable accessibilityRole="button" onPress={() => { void requestPermission(); }} style={styles.secondary}>
          <Text style={styles.secondaryText}>알림 허용하기</Text>
        </Pressable>
      )}
    </View>
  );
}
