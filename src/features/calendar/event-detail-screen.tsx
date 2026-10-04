import { useCallback, useRef, useState } from 'react';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { dateLabel, EVENT_STATUS_LABELS, eventDate, eventTimeLabel } from '../../application/planner/calendar-model';
import { reminderLabel } from '../../application/planner/event-form';
import { utcToZonedFields } from '../../application/planner/zoned-time';
import { describeReminder } from '../../application/notifications/reminder-status';
import { describeSilence, resolveSilence } from '../../application/notifications/resolve-silence';
import { localDateIn } from '../../application/validator/local-date';
import type { Event } from '../../domain/event/event';
import { eventLifecycleStatus } from '../../domain/event/event-lifecycle';
import type { Reminder } from '../../domain/reminder/reminder';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useSettings } from '../settings/settings-context';
import { useNotifications } from '../settings/notification-context';
import { leaveScreen } from './leave';
import { usePlanner } from './planner-context';

/** K2: one event with its time, place, reminders (and why they may be silent), status and actions. */
export function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const { settings } = useSettings();
  const notifications = useNotifications();
  const permission = notifications.permission;
  const [event, setEvent] = useState<Event | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const eventId = typeof id === 'string' ? id : '';

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setFailed(false);
    Promise.all([planner.findEvent(eventId), planner.remindersOf('EVENT', eventId)])
      .then(([found, list]) => { if (active) { setEvent(found); setReminders(list); } })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicit invalidation key reloads committed local data.
  }, [planner, eventId, attempt]));

  async function run(action: () => Promise<{ status: 'DONE'; warnings: string[] } | { status: 'FAILED'; message: string }>, leaveOnSuccess: boolean) {
    if (busy.current) return;
    busy.current = true; setWorking(true); setMessage(null);
    try {
      const result = await action();
      if (result.status === 'FAILED') setMessage(result.message);
      else if (leaveOnSuccess) leaveScreen();
      else { setAttempt(count => count + 1); if (result.warnings.length) setMessage(result.warnings.join(' ')); }
    } catch {
      setMessage('처리를 확인하지 못했어요. 목록을 확인하고 다시 시도해 주세요');
    } finally { busy.current = false; setWorking(false); }
  }

  const now = planner.now();
  const live = reminders.filter(item => item.status !== 'CANCELLED');
  const lifecycle = event ? eventLifecycleStatus(event, now, localDateIn(event.timezone, now)) : null;
  const silence = resolveSilence({ allOn: settings.allOn, ownOn: settings.ownOn, permission, friendNotifyEventTime: null, isReceived: false });
  const date = event ? eventDate(event) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '일정' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator accessibilityLabel="일정 불러오는 중" />
          : failed ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.error}>일정을 불러오지 못했어요.</Text>
              <Pressable accessibilityRole="button" onPress={() => setAttempt(count => count + 1)} style={styles.secondary}><Text style={styles.secondaryText}>다시 불러오기</Text></Pressable>
            </View>
          ) : !event || !lifecycle ? (
            <View style={styles.card}>
              <Text style={styles.heading}>찾을 수 없어요</Text>
              <Text style={styles.muted}>삭제되었거나 이 기기에 없는 일정이에요.</Text>
              <Pressable accessibilityRole="button" onPress={() => leaveScreen()} style={styles.secondary}><Text style={styles.secondaryText}>돌아가기</Text></Pressable>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <View style={styles.spread}>
                  <Text style={styles.eyebrow}>일정</Text>
                  <View style={styles.badge}><Text style={styles.badgeText}>{EVENT_STATUS_LABELS[lifecycle]}</Text></View>
                </View>
                <Text style={styles.title} accessibilityRole="header">{event.title}</Text>
                <Text style={styles.text}>{date ? dateLabel(date) : '날짜 없음'} · {eventTimeLabel(event)}</Text>
                {!!event.location && <Text style={styles.text}>장소 · {event.location}</Text>}
                {event.visibility === 'PUBLIC' && <Text style={styles.muted}>친구에게 공개 중</Text>}
              </View>

              <View style={styles.card}>
                <Text style={styles.heading} accessibilityRole="header">알림</Text>
                {event.kind !== 'EXACT' ? (
                  <Text style={styles.muted}>정확한 시각이 없는 일정이라 알림을 맞출 수 없어요.</Text>
                ) : live.length === 0 ? (
                  <Text style={styles.muted}>알림 없음</Text>
                ) : (
                  <>
                    {silence.silent && (
                      <View accessibilityRole="alert" style={styles.banner}>
                        <Text style={[styles.bannerText, { fontWeight: '700' }]}>알림 꺼짐</Text>
                        <Text style={styles.bannerText}>{describeSilence(silence.reason, '')}</Text>
                        {silence.reason === 'PERMISSION_BLOCKED' && (
                          <Pressable accessibilityRole="button" onPress={notifications.openSystemSettings} style={styles.linkButton}>
                            <Text style={styles.linkText}>설정 열기</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                    {!silence.silent && permission === 'UNDETERMINED' && (
                      <View style={styles.banner}>
                        <Text style={styles.bannerText}>알림을 받으려면 알림을 허용해야 해요.</Text>
                        <Pressable accessibilityRole="button" onPress={() => { void notifications.requestPermission().then(() => setAttempt(count => count + 1)); }} style={styles.linkButton}>
                          <Text style={styles.linkText}>알림 허용하기</Text>
                        </Pressable>
                      </View>
                    )}
                    {live.map(item => {
                      const view = describeReminder(item, now);
                      const fire = utcToZonedFields(item.fireAt, event.timezone);
                      return (
                        <View key={item.id} style={styles.listRow}>
                          <View style={styles.listBody}>
                            <Text style={styles.listTitle}>{item.relativeOffsetMinutes === null ? '직접 지정한 알림' : reminderLabel(item.relativeOffsetMinutes)}</Text>
                            <Text style={styles.listMeta}>{dateLabel(fire.date)} {fire.time}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.listMeta, view.attention && { color: palette.danger, fontWeight: '700' }]}>{view.text}</Text>
                            {view.retryable && (
                              <Pressable accessibilityRole="button" accessibilityLabel="알림 다시 시도" onPress={() => { void notifications.sync().then(() => setAttempt(count => count + 1)); }} style={styles.linkButton}>
                                <Text style={styles.linkText}>다시 시도</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </>
                )}
              </View>

              {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}

              <Pressable
                accessibilityRole="button"
                disabled={working}
                onPress={() => router.push({ pathname: '/entry-form', params: { type: 'event', id: event.id } })}
                style={[styles.button, working && styles.disabled]}>
                <Text style={styles.buttonText}>수정</Text>
              </Pressable>
              {(lifecycle === 'UPCOMING' || lifecycle === 'PAST') && event.status !== 'COMPLETED' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: working, busy: working }}
                  disabled={working}
                  onPress={() => run(() => planner.completeEvent(event), true)}
                  style={[styles.secondary, working && styles.disabled]}>
                  <Text style={styles.secondaryText}>완료로 표시</Text>
                </Pressable>
              )}
              <Text style={styles.hint}>친구에게 보내기는 로그인 후에 쓸 수 있어요.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: working, busy: working }}
                disabled={working}
                onPress={() => run(() => planner.deleteEvent(event), true)}
                style={[styles.secondary, styles.danger, working && styles.disabled]}>
                <Text style={styles.dangerText}>{working ? '처리 중…' : '삭제'}</Text>
              </Pressable>
              <Text style={styles.hint}>삭제하면 화면 아래에서 잠시 되돌릴 수 있어요.</Text>
            </>
          )}
      </ScrollView>
    </SafeAreaView>
  );
}
