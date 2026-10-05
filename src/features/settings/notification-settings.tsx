import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { DEFAULT_REMINDER_CHOICES, type DefaultReminder } from '../../application/settings/app-settings';
import { reminderLabel } from '../../application/planner/event-form';
import { PillGroup } from '../calendar/form-controls';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useNotifications } from './notification-context';
import { NotificationPermissionNotice } from './notification-permission-notice';
import { SettingGroup, SettingPanel, SettingSwitch } from './setting-parts';
import { useSettings } from './settings-context';

const DEFAULT_OPTIONS = DEFAULT_REMINDER_CHOICES.map(value => ({ value: value === null ? 'NONE' : String(value), label: value === null ? '없음' : reminderLabel(value) }));
const toKey = (value: DefaultReminder) => (value === null ? 'NONE' : String(value));
const fromKey = (key: string): DefaultReminder => DEFAULT_REMINDER_CHOICES.find(value => toKey(value) === key) ?? 0;

/**
 * Settings > notifications (blueprint 8.2, 10.1; design `#settingsPage` "알림"): all notifications, my own events, the reminder
 * new events start with, the lock-screen title, and the device permission. Every change is saved first and then applied to the
 * system's notifications. "All off" wins over everything below it, so those rows are shown as inactive and say why.
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
    <SettingGroup label="알림">
      <SettingPanel>
        <SettingSwitch title="모든 알림" hint="끄면 일정 알림이 모두 멈춰요. 전체 끔이 일정별 설정보다 우선해요." value={settings.allOn} onChange={value => { void change({ allOn: value }); }} />
        {off && <Text style={styles.settingHint}>모든 알림이 꺼져 있어서 아래 설정은 적용되지 않아요.</Text>}
        <SettingSwitch title="내 일정 알림" hint="내가 만든 일정과 할 일이 시각에 맞춰 울려요." value={settings.ownOn} disabled={off} onChange={value => { void change({ ownOn: value }); }} />
        <View style={styles.panelBlock}>
          <Text style={styles.settingTitle}>기본 알림</Text>
          <Text style={styles.settingHint}>새 일정을 만들면 이 시각에 알려 드려요. “1시간 전에 알려줘”처럼 따로 말하면 그 말이 우선해요.</Text>
          <PillGroup
            label="새 일정의 기본 알림"
            options={DEFAULT_OPTIONS}
            value={toKey(settings.ownDefault)}
            disabled={off}
            onChange={key => { void change({ ownDefault: fromKey(key) }); }}
          />
        </View>
        <SettingSwitch title="잠금 화면에 일정 제목 표시" hint="끄면 “일정 알림 · 30분 후”처럼 제목 없이 보여요." value={settings.lockscreenShowTitle} disabled={off} onChange={value => { void change({ lockscreenShowTitle: value }); }} />
        <NotificationPermissionNotice />
      </SettingPanel>
      {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
    </SettingGroup>
  );
}
