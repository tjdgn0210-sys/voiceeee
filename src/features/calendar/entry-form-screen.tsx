import { useEffect, useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  eventFormFromEvent, FUZZY_SUGGESTIONS, initialEventForm, initialTaskForm, REMINDER_OFFSETS, reminderLabel,
  TIME_KIND_LABELS, taskFormFromTask, todayIn, type EventForm, type FormErrors, type TaskForm,
} from '../../application/planner/event-form';
import type { EventTimeKind } from '../../application/proposals/action-payloads';
import type { Event } from '../../domain/event/event';
import type { Reminder } from '../../domain/reminder/reminder';
import type { Task } from '../../domain/task/task';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useSettings } from '../settings/settings-context';
import { useIsLoggedIn } from '../settings/use-is-logged-in';
import { ChipGroup, FieldInput, SegmentControl, SwitchRow } from './form-controls';
import { PickerField } from './picker-field';
import { usePlanner } from './planner-context';

type EntryType = 'event' | 'task';

const ENTRY_TYPE_OPTIONS: readonly { value: EntryType; label: string }[] = [{ value: 'event', label: '약속' }, { value: 'task', label: '할 일' }];
const REMINDER_OPTIONS = REMINDER_OFFSETS.map(value => ({ value, label: reminderLabel(value) }));
const TIME_KIND_OPTIONS = (Object.keys(TIME_KIND_LABELS) as EventTimeKind[]).map(value => ({ value, label: TIME_KIND_LABELS[value] }));

/** H4 manual entry: appointment or to-do (create), or edit of an existing one. */
export function EntryFormScreen() {
  const params = useLocalSearchParams<{ type?: string; id?: string; date?: string; title?: string }>();
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const editingId = typeof params.id === 'string' ? params.id : null;
  const [type, setType] = useState<EntryType>(params.type === 'task' ? 'task' : 'event');
  const [loaded, setLoaded] = useState<{ event: Event | null; task: Task | null; reminders: Reminder[] } | null>(editingId ? null : { event: null, task: null, reminders: [] });
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!editingId) return;
    let active = true;
    const targetType = type === 'task' ? 'TASK' : 'EVENT';
    Promise.all([
      type === 'task' ? planner.findTask(editingId) : planner.findEvent(editingId),
      planner.remindersOf(targetType, editingId),
    ]).then(([entity, reminders]) => {
      if (!active) return;
      setLoaded({ event: type === 'event' ? (entity as Event | null) : null, task: type === 'task' ? (entity as Task | null) : null, reminders });
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [planner, editingId, type, attempt]);

  const title = editingId ? (type === 'task' ? '할 일 수정' : '일정 수정') : '새로 적기';
  const missing = editingId && loaded && !(type === 'task' ? loaded.task : loaded.event);
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {!editingId && (
            <SegmentControl<EntryType>
              label="종류"
              value={type}
              options={ENTRY_TYPE_OPTIONS}
              onChange={setType}
            />
          )}
          {!editingId && (
            <Pressable accessibilityRole="button" onPress={() => router.replace('/manual-expense')} style={styles.linkButton}>
              <Text style={styles.linkText}>지출을 적으려면 여기를 눌러요</Text>
            </Pressable>
          )}
          {loadFailed ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.error}>불러오지 못했어요.</Text>
              <Pressable accessibilityRole="button" onPress={() => { setLoadFailed(false); setAttempt(count => count + 1); }} style={styles.secondary}>
                <Text style={styles.secondaryText}>다시 불러오기</Text>
              </Pressable>
            </View>
          ) : !loaded ? (
            <ActivityIndicator accessibilityLabel="불러오는 중" />
          ) : missing ? (
            <View style={styles.card}>
              <Text style={styles.heading}>찾을 수 없어요</Text>
              <Text style={styles.muted}>이미 삭제되었거나 이 기기에 없는 항목이에요.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondary}><Text style={styles.secondaryText}>돌아가기</Text></Pressable>
            </View>
          ) : type === 'event' ? (
            <EventFormBody key={`event-${loaded.event?.updatedAt ?? 'new'}`} existing={loaded.event} reminders={loaded.reminders} initialTitle={params.title} initialDate={params.date} />
          ) : (
            <TaskFormBody key={`task-${loaded.task?.updatedAt ?? 'new'}`} existing={loaded.task} reminders={loaded.reminders} initialTitle={params.title} initialDate={params.date} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** After a save with partial failures the form is replaced by this list, so the failure is never missed. */
function SavedWithWarnings({ warnings }: { warnings: string[] }) {
  const styles = useExpenseStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">저장했어요, 확인할 것이 있어요</Text>
      <View accessibilityRole="alert" style={styles.banner}>
        {warnings.map(warning => <Text key={warning} style={styles.bannerText}>• {warning}</Text>)}
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.button}><Text style={styles.buttonText}>확인</Text></Pressable>
    </View>
  );
}

function EventFormBody({ existing, reminders, initialTitle, initialDate }: { existing: Event | null; reminders: Reminder[]; initialTitle?: string; initialDate?: string }) {
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const { settings } = useSettings();
  const loggedIn = useIsLoggedIn();
  const [form, setForm] = useState<EventForm>(() => existing
    ? eventFormFromEvent(existing, planner.timezone(), reminders)
    : initialEventForm({ now: planner.now(), timezone: planner.timezone(), defaultReminder: settings.ownDefault, title: initialTitle, date: initialDate }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const busy = useRef(false);
  // One id per form session: a retry after an unclear failure cannot create the event twice.
  const actionId = useRef(planner.newActionId());

  const change = (patch: Partial<EventForm>) => { setForm(current => ({ ...current, ...patch })); setErrors({}); setMessage(null); };
  const exact = form.timeKind === 'EXACT';

  async function save() {
    if (busy.current) return;
    busy.current = true; setSaving(true); setMessage(null);
    try {
      const result = existing ? await planner.updateEvent(existing, form) : await planner.createEvent(form, actionId.current);
      if (result.status === 'INVALID') setErrors(result.errors);
      else if (result.status === 'FAILED') setMessage(result.message);
      else if (result.warnings.length) setWarnings(result.warnings);
      else router.back();
    } catch {
      setMessage('저장을 확인하지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요');
    } finally { busy.current = false; setSaving(false); }
  }

  if (warnings) return <SavedWithWarnings warnings={warnings} />;
  const today = todayIn(planner.timezone(), planner.now());
  return (
    <View style={styles.formStack}>
      <FieldInput label="제목" value={form.title} maxLength={100} placeholder="치과 예약" editable={!saving} error={errors.title} onChangeText={title => change({ title })} />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>시간 방식</Text>
        <SegmentControl
          label="시간 방식"
          value={form.timeKind}
          options={TIME_KIND_OPTIONS}
          disabled={saving}
          onChange={timeKind => change({ timeKind, reminderOffsets: timeKind === 'EXACT' ? form.reminderOffsets : [] })}
        />
        {form.timeKind === 'FUZZY' && <Text style={styles.hint}>정확한 시각이 없어서 알림은 맞출 수 없어요. 캘린더에는 “저녁쯤”처럼 보여요.</Text>}
        {form.timeKind === 'ALL_DAY' && <Text style={styles.hint}>종일 일정은 시각이 없어서 알림은 맞출 수 없어요. 캘린더에는 “종일”로 보여요.</Text>}
      </View>
      <View style={styles.row}>
        <PickerField kind="date" label="날짜" value={form.date} disabled={saving} error={errors.date} onChange={date => change({ date })} />
        {exact && <PickerField kind="time" label="시작 시각" value={form.time} disabled={saving} error={errors.time} onChange={time => change({ time })} />}
      </View>
      {exact && (
        <View style={styles.row}>
          <PickerField kind="time" label="종료 시각 (선택)" value={form.endTime || form.time} disabled={saving} error={errors.endTime} onChange={endTime => change({ endTime })} />
          {!!form.endTime && (
            <Pressable accessibilityRole="button" accessibilityLabel="종료 시각 지우기" onPress={() => change({ endTime: '' })} style={styles.linkButton}>
              <Text style={styles.linkText}>종료 시각 지우기</Text>
            </Pressable>
          )}
        </View>
      )}
      {form.timeKind === 'FUZZY' && (
        <View style={styles.field}>
          <FieldInput label="대략 언제쯤인가요" value={form.fuzzyTime} maxLength={20} placeholder="저녁쯤" editable={!saving} error={errors.fuzzyTime} onChangeText={fuzzyTime => change({ fuzzyTime })} />
          <ChipGroup label="자주 쓰는 표현" options={FUZZY_SUGGESTIONS.map(value => ({ value, label: value }))} selected={[form.fuzzyTime]} disabled={saving} onToggle={fuzzyTime => change({ fuzzyTime })} />
        </View>
      )}
      <FieldInput label="장소 (선택)" value={form.location} maxLength={100} placeholder="3층 회의실" editable={!saving} error={errors.location} onChangeText={location => change({ location })} />
      {exact && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>알림</Text>
          <ChipGroup
            label="알림"
            options={REMINDER_OPTIONS}
            selected={form.reminderOffsets}
            disabled={saving}
            onToggle={offset => change({ reminderOffsets: form.reminderOffsets.includes(offset) ? form.reminderOffsets.filter(item => item !== offset) : [...form.reminderOffsets, offset].sort((a, b) => b - a) })}
          />
          <Text style={styles.hint}>모두 끄면 알림 없이 저장돼요. 새 일정에 미리 골라 두는 알림은 설정에서 바꿀 수 있어요.</Text>
        </View>
      )}
      {loggedIn && (
        <SwitchRow title="친구에게 공개" hint="제목 · 시간 · 장소만 보여요" value={form.visibility === 'PUBLIC'} disabled={saving} onChange={on => change({ visibility: on ? 'PUBLIC' : 'PRIVATE' })} />
      )}
      {form.date === today && exact && <Text style={styles.hint}>오늘 일정이에요.</Text>}
      {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: saving, busy: saving }}
        disabled={saving}
        onPress={save}
        style={[styles.button, saving && styles.disabled]}>
        <Text style={styles.buttonText}>{saving ? '저장 중…' : '저장'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => router.back()} style={styles.secondary}><Text style={styles.secondaryText}>취소</Text></Pressable>
    </View>
  );
}

function TaskFormBody({ existing, reminders, initialTitle, initialDate }: { existing: Task | null; reminders: Reminder[]; initialTitle?: string; initialDate?: string }) {
  const planner = usePlanner();
  const styles = useExpenseStyles();
  const loggedIn = useIsLoggedIn();
  const [form, setForm] = useState<TaskForm>(() => existing
    ? taskFormFromTask(existing, planner.timezone(), reminders)
    : initialTaskForm({ now: planner.now(), timezone: planner.timezone(), title: initialTitle, date: initialDate }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const busy = useRef(false);
  const actionId = useRef(planner.newActionId());
  const change = (patch: Partial<TaskForm>) => { setForm(current => ({ ...current, ...patch })); setErrors({}); setMessage(null); };

  async function save() {
    if (busy.current) return;
    busy.current = true; setSaving(true); setMessage(null);
    try {
      const result = existing ? await planner.updateTask(existing, form) : await planner.createTask(form, actionId.current);
      if (result.status === 'INVALID') setErrors(result.errors);
      else if (result.status === 'FAILED') setMessage(result.message);
      else if (result.warnings.length) setWarnings(result.warnings);
      else router.back();
    } catch {
      setMessage('저장을 확인하지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해 주세요');
    } finally { busy.current = false; setSaving(false); }
  }

  if (warnings) return <SavedWithWarnings warnings={warnings} />;
  return (
    <View style={styles.formStack}>
      <FieldInput label="제목" value={form.title} maxLength={100} placeholder="서류 제출하기" editable={!saving} error={errors.title} onChangeText={title => change({ title })} />
      <SwitchRow title="마감 날짜 정하기" hint="정하지 않으면 날짜 없는 할 일로 남아요" value={form.hasDue} disabled={saving} onChange={hasDue => change({ hasDue, reminderOffsets: hasDue ? form.reminderOffsets : [] })} />
      {form.hasDue && (
        <>
          <View style={styles.row}>
            <PickerField kind="date" label="마감 날짜" value={form.date} disabled={saving} error={errors.date} onChange={date => change({ date })} />
            <PickerField kind="time" label="마감 시각" value={form.time} disabled={saving} error={errors.time} onChange={time => change({ time })} />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>알림</Text>
            <ChipGroup
              label="알림"
              options={REMINDER_OPTIONS}
              selected={form.reminderOffsets}
              disabled={saving}
              onToggle={offset => change({ reminderOffsets: form.reminderOffsets.includes(offset) ? form.reminderOffsets.filter(item => item !== offset) : [...form.reminderOffsets, offset].sort((a, b) => b - a) })}
            />
            <Text style={styles.hint}>고르지 않으면 알림 없이 저장돼요.</Text>
          </View>
        </>
      )}
      {loggedIn && (
        <SwitchRow title="친구에게 공개" hint="제목 · 마감만 보여요" value={form.visibility === 'PUBLIC'} disabled={saving} onChange={on => change({ visibility: on ? 'PUBLIC' : 'PRIVATE' })} />
      )}
      {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: saving, busy: saving }}
        disabled={saving}
        onPress={save}
        style={[styles.button, saving && styles.disabled]}>
        <Text style={styles.buttonText}>{saving ? '저장 중…' : '저장'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => router.back()} style={styles.secondary}><Text style={styles.secondaryText}>취소</Text></Pressable>
    </View>
  );
}
