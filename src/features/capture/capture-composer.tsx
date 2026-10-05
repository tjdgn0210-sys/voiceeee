import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { useExpenses } from './expense-context';
import { useInterpretCapture } from './interpretation-context';
import { useVoiceCapture } from './voice-capture-context';
import { usePersistentDraft } from './use-persistent-draft';
import { DraftStatus } from './draft-status';
import { palette } from './expense-styles';
import { useExpenseStyles } from './use-expense-styles';
import { createCaptureFlow, type CaptureSource, type ParsedOutcome } from '../../application/capture/capture-flow';
import { createCaptureParserInput } from '../../application/proposals/capture-parser-router';
import type { CreateTransactionProposal } from '../../application/validator/validate-create-transaction';
import type { VoiceCaptureState } from '../../application/capture/voice-expense-capture';
import { useUndoBar } from '../../hooks/use-undo-bar';

/** Failures that mean "the AI could not be reached": the sentence is kept as a pending draft and retried only by the user. */
const UNAVAILABLE_REASONS = ['NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'];

type Shown =
  | { kind: 'SAVED'; proposal: CreateTransactionProposal; transactionId: string }
  | { kind: 'DUPLICATE'; proposal: CreateTransactionProposal }
  | { kind: 'REVIEW'; proposal: CreateTransactionProposal };

export function CaptureComposer({ onSaved }: { onSaved(): void }) {
  const expenses = useExpenses();
  const voice = useVoiceCapture();
  const interpret = useInterpretCapture();
  const undoBar = useUndoBar();
  const styles = useExpenseStyles();
  const generation = useRef(0);
  const editor = usePersistentDraft('capture', { text: '' });
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<VoiceCaptureState>('IDLE');
  const [partial, setPartial] = useState('');
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const active = state !== 'IDLE';
  const flow = useMemo(() => createCaptureFlow({
    save: proposal => expenses.save(proposal),
    recentExpenses: expenses.history,
    undo: undoId => expenses.undo(undoId),
    undoBar,
    now: expenses.now,
  }), [expenses, undoBar]);

  useFocusEffect(useCallback(() => {
    const subscription = AppState.addEventListener('change', value => { if (value !== 'active') { generation.current++; voice.cancel(); } });
    return () => { generation.current++; voice.cancel(false); subscription.remove(); };
  }, [voice]));

  /** Shows what happened to a parsed expense; a saved one also clears the draft. */
  async function present(outcome: ParsedOutcome) {
    if (outcome.status === 'CLARIFY' || outcome.status === 'FAILED') { setMessage(outcome.message); return; }
    if (outcome.status === 'DUPLICATE') { setShown({ kind: 'DUPLICATE', proposal: outcome.proposal }); return; }
    if (outcome.status === 'REVIEW') { setShown({ kind: 'REVIEW', proposal: outcome.proposal }); return; }
    setShown({ kind: 'SAVED', proposal: outcome.proposal, transactionId: outcome.transactionId });
    setPartial(''); onSaved();
    try { await editor.clear(); } catch { setMessage('지출은 저장했습니다. 초안 정리는 실패했습니다. 목록을 확인해 주세요.'); }
  }

  async function analyze() {
    if (busy.current || active || !editor.ready) return;
    busy.current = true; setWorking(true); setMessage(null); setShown(null); setPending(null);
    try {
      const revision = generation.current;
      await editor.persist();
      const draft = editor.draft;
      const parsed = await interpret(createCaptureParserInput(draft.fields.text ?? '', draft.actionId, draft.inputMethod === 'VOICE' ? 'VOICE' : 'TEXT', draft.capturedAt));
      if (revision !== generation.current) return;
      if (parsed.status === 'PARSED') await present(await flow.handleParsed(parsed.proposal, parsed.source));
      else if (parsed.status === 'FAILED' && UNAVAILABLE_REASONS.includes(parsed.reason)) setPending(parsed.message);
      else setMessage(`${parsed.message} 문장을 수정하거나 직접 입력해 주세요.`);
    } catch { setMessage('초안을 보존하지 못했습니다. 내용을 확인하고 다시 시도해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }

  /** The user confirmed a repeated entry or an AI result. */
  async function saveConfirmed() {
    if (busy.current || !shown || shown.kind === 'SAVED') return;
    busy.current = true; setWorking(true); setMessage(null);
    try { await present(await flow.saveConfirmed(shown.proposal)); }
    catch { setMessage('저장을 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }

  async function discard() {
    if (busy.current || active) return;
    busy.current = true; setWorking(true);
    try { await editor.clear(); setShown(null); setPending(null); setMessage(null); setPartial(''); }
    catch { setMessage('초안을 지우지 못했습니다. 다시 시도해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }

  function startVoice() {
    setShown(null); setMessage(null); setPending(null);
    void voice.start({ onState: setState, onPartial: setPartial, onMessage: value => setMessage(value || null),
      async onTranscript(text) {
        editor.replace({ actionId: expenses.newActionId(), capturedAt: expenses.now(), inputMethod: 'VOICE', fields: { text } });
        await editor.persist();
      },
      async onReview(proposal, capturedAt, source: CaptureSource) {
        editor.replace({ actionId: proposal.actionId, capturedAt, inputMethod: 'VOICE', fields: { text: proposal.sourceInput } });
        await editor.persist(); setPartial('');
        await present(await flow.handleParsed(proposal, source));
      },
    });
  }
  const disabled = working || active || !editor.ready;
  const dateText = (iso: string) => new Date(iso).toLocaleString('ko-KR');
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>빠른 기록</Text>
    <Text style={styles.heading}>말하거나 적어서 기록하세요.</Text>
    <Text style={styles.muted}>예: “점심 7000원 썼어” · 저장한 뒤 [되돌리기]로 취소할 수 있어요.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: working || !editor.ready || (active && state !== 'LISTENING'), busy: active && state !== 'LISTENING' }}
      disabled={working || !editor.ready || (active && state !== 'LISTENING')} onPress={state === 'LISTENING' ? () => voice.stop() : startVoice}
      style={({ pressed }) => [styles.button, styles.voiceButton, pressed && styles.pressed, (working || !editor.ready) && styles.disabled]}>
      <Text style={styles.buttonText}>{state === 'LISTENING' ? '말하기 마치기' : state === 'CHECKING' ? '마이크 확인 중…' : state === 'STOPPING' ? '음성 마무리 중…' : state === 'PROCESSING' ? '입력 확인 중…' : '말하기 시작'}</Text>
    </Pressable>
    {active && <Pressable accessibilityRole="button" onPress={() => voice.cancel()} style={styles.secondary}><Text style={styles.secondaryText}>음성 입력 취소</Text></Pressable>}
    {partial !== '' && <Text style={styles.text} accessibilityLiveRegion="polite">{partial}</Text>}
    <Text style={styles.fieldLabel}>문장으로 입력</Text>
    <TextInput accessibilityLabel="지출 문장 입력" placeholder="점심 7000원 썼어" placeholderTextColor={palette.placeholder} maxLength={1000}
      value={editor.draft.fields.text ?? ''} editable={!disabled} style={styles.input} returnKeyType="done" onSubmitEditing={analyze}
      onChangeText={text => { editor.update({ text }, 'TEXT'); setShown(null); setPending(null); setMessage(null); }} />
    <DraftStatus status={editor.status} onRetry={() => { void editor.retry().catch(() => {}); }} onDiscard={!editor.ready ? () => { void editor.clear().catch(() => {}); } : undefined} />
    <Pressable accessibilityRole="button" disabled={disabled || !editor.draft.fields.text?.trim()} accessibilityState={{ disabled: disabled || !editor.draft.fields.text?.trim(), busy: working }}
      onPress={analyze} style={[styles.secondary, disabled && styles.disabled]}><Text style={styles.secondaryText}>{working ? '입력 처리 중…' : '기록하기'}</Text></Pressable>

    {pending && <View accessibilityRole="alert" style={styles.requestCard}>
      <Text style={styles.heading}>처리 대기 중인 문장이에요</Text>
      <Text style={styles.muted}>{pending} 문장은 이 기기에 보관했어요. 연결되면 직접 [다시 처리]를 눌러 주세요. 자동으로 실행하지 않아요.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: working }} disabled={disabled} onPress={analyze} style={[styles.secondary, disabled && styles.disabled]}><Text style={styles.secondaryText}>다시 처리</Text></Pressable>
    </View>}

    {shown?.kind === 'SAVED' && <View accessibilityLiveRegion="polite" style={styles.review}>
      <Text style={styles.eyebrow}>저장했어요</Text>
      <Text style={styles.amount}>{shown.proposal.payload.amount?.toLocaleString('ko-KR')}원</Text>
      <Text style={styles.text}>{shown.proposal.payload.category ?? '미분류'} · {shown.proposal.payload.memo ?? '메모 없음'}</Text>
      <Text style={styles.muted}>{dateText(shown.proposal.payload.occurredAt!)} · 지출</Text>
      <Text style={styles.muted}>잘못 들었다면 화면 아래의 [되돌리기]를 눌러요.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/expense', params: { id: shown.transactionId } })} style={styles.linkButton}><Text style={styles.linkText}>자세히 보기 · 수정</Text></Pressable>
    </View>}

    {shown?.kind === 'DUPLICATE' && <View accessibilityRole="alert" style={styles.requestCard}>
      <Text style={styles.heading}>같은 기록이 방금 있어요</Text>
      <Text style={styles.muted}>{shown.proposal.payload.amount?.toLocaleString('ko-KR')}원{shown.proposal.payload.memo ? ` · ${shown.proposal.payload.memo}` : ''}을(를) 방금 저장했어요. 또 저장할까요?</Text>
      <View style={styles.buttonRow}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: working, busy: working }} disabled={working} onPress={saveConfirmed} style={[styles.smallButton, working && styles.disabled]}><Text style={styles.smallButtonText}>{working ? '저장 중…' : '또 저장'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={working} onPress={() => setShown(null)} style={styles.smallSecondary}><Text style={styles.smallSecondaryText}>저장 안 함</Text></Pressable>
      </View>
    </View>}

    {shown?.kind === 'REVIEW' && <View style={styles.review}>
      <Text style={styles.heading}>이 내용으로 기록할까요?</Text>
      <Text style={styles.amount}>{shown.proposal.payload.amount?.toLocaleString('ko-KR')}원</Text>
      <Text style={styles.text}>{shown.proposal.payload.category ?? '미분류'} · {shown.proposal.payload.memo ?? '메모 없음'}</Text>
      <Text style={styles.muted}>{dateText(shown.proposal.payload.occurredAt!)} · 지출</Text>
      <Pressable accessibilityRole="button" disabled={working} accessibilityState={{ disabled: working, busy: working }} onPress={saveConfirmed} style={[styles.button, working && styles.disabled]}><Text style={styles.buttonText}>{working ? '지출 저장 중…' : '이 내용으로 저장'}</Text></Pressable>
      <Text style={styles.muted}>금액이나 분류가 다르면 문장을 수정하거나 직접 입력하세요.</Text>
    </View>}

    {message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}

    {/* Secondary actions are text links under a thin line. */}
    <View style={styles.divider} />
    <View style={styles.linkRow}>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => router.push('/manual-expense')} style={[styles.linkButton, disabled && styles.disabled]}><Text style={styles.linkText}>지출 직접 입력</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => router.push('/entry-form')} style={[styles.linkButton, disabled && styles.disabled]}><Text style={styles.linkText}>일정 · 할 일 입력</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => router.push('/ai-settings')} style={styles.linkButton}><Text style={styles.linkText}>AI 연결 설정</Text></Pressable>
      {!!editor.draft.fields.text && <Pressable accessibilityRole="button" disabled={disabled} style={styles.linkButton}
        onPress={discard}><Text style={styles.linkText}>초안 비우기</Text></Pressable>}
    </View>
  </View>;
}
