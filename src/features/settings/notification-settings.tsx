import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { DEFAULT_REMINDER_CHOICES, type DefaultReminder } from '../../application/settings/app-settings';
import { reminderLabel } from '../../application/planner/event-form';
import { ChipGroup, SwitchRow } from '../calendar/form-controls';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useNotifications } from './notification-context';
import { NotificationPermissionNotice } from './notification-permission-notice';
import { useSettings } from './settings-context';

const DEFAULT_OPTIONS = DEFAULT_REMINDER_CHOICES.map(value => ({ value: value === null ? 'NONE' : String(value), label: value === null ? '없음' : reminderLabel(value) }));
const toKey = (value: DefaultReminder) => (value === null ? 'NONE' : String(value));
const fromKey = (key: string): DefaultReminder => DEFAULT_REMINDER_CHOICES.find(value => toKey(value) === key) ?? 0;

/**
 * Settings > notifications (blueprint 8.2, 10.1): all notifications, my own events, the reminder new events start with,
 * the lock-screen title, and the device permission. Every change is saved first and then applied to the system's notifications.
 * "All off" wins over everything below it, so those rows are shown as inactive and say why.
 */
export function NotificationSettings() {
  const styles = useExpenseStyles();
  const { settings, update } = useSettings();
  const { sync } = useNotifications();
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  async function change(patch: Parameters<typeof update>[0]) {
    if (busy.current) return;
    busy.current = true; setMessage(null);
    try {
      await update(patch);
      const report = await sync();
      if (report.warnings.length) setMessage(report.warnings.join(' '));
    } catch {
      setMessage('바꾸지 못했어요. 다시 시도해 주세요');
    } finally { busy.current = false; }
  }

  const off = !settings.allOn;
  return (
    <View style={styles.formStack}>
      <SwitchRow title="모든 알림" hint="끄면 아래 설정과 관계없이 알림이 울리지 않아요" value={settings.allOn} onChange={value => { void change({ allOn: value }); }} />
      {off && <Text style={styles.hint}>모든 알림이 꺼져 있어서 아래 설정은 적용되지 않아요.</Text>}
      <SwitchRow title="내 일정 알림" hint="내가 만든 일정과 할 일의 알림" value={settings.ownOn} disabled={off} onChange={value => { void change({ ownOn: value }); }} />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>새 일정의 기본 알림</Text>
        <ChipGroup
          label="새 일정의 기본 알림"
          options={DEFAULT_OPTIONS}
          selected={[toKey(settings.ownDefault)]}
          disabled={off}
          onToggle={key => { void change({ ownDefault: fromKey(key) }); }}
        />
        <Text style={styles.hint}>새 일정을 적을 때 미리 골라 두는 알림이에요. 문장에서 따로 말한 알림이 있으면 그 알림이 먼저예요.</Text>
      </View>
      <SwitchRow title="잠금 화면에 제목 보이기" hint="끄면 알림에 “일정 알림 · 30분 후”처럼만 보여요" value={settings.lockscreenShowTitle} disabled={off} onChange={value => { void change({ lockscreenShowTitle: value }); }} />
      <NotificationPermissionNotice />
      {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
    </View>
  );
}
