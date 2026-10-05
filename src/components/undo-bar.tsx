import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '../features/capture/expense-styles';
import { useScaler } from '../features/settings/settings-context';
import { Radius, Spacing } from '../constants/theme';
import { useUndoBar, useUndoBarState } from '../hooks/use-undo-bar';

/** The transient "되돌리기" bar (blueprint 11.3, design `.undoToast`): an ink area above the tab bar with a light text button. */
export function UndoBarHost() {
  const bar = useUndoBar();
  const state = useUndoBarState();
  const insets = useSafeAreaInsets();
  const s = useScaler();
  if (state.status === 'HIDDEN') return null;

  const working = state.status === 'WORKING';
  const message = state.status === 'SHOWN' || state.status === 'WORKING' ? (working ? '되돌리는 중…' : state.entry.label) : state.message;
  const failed = state.status === 'FAILED';
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + s.touch + s.space(36), paddingHorizontal: Spacing.three }]}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole={failed ? 'alert' : undefined}
        style={[styles.bar, { paddingVertical: s.space(4), paddingLeft: s.space(18), paddingRight: s.space(8), gap: s.space(12), minHeight: s.touch }, failed && styles.barFailed]}>
        <Text style={[styles.message, { fontSize: s.font(14), lineHeight: s.font(20) }]}>{message}</Text>
        {state.status === 'SHOWN' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="되돌리기"
            onPress={() => { void bar.run(); }}
            style={({ pressed }) => [styles.action, { minHeight: s.touch }, pressed && styles.pressed]}>
            <Text style={[styles.actionText, { fontSize: s.font(14) }]}>되돌리기</Text>
          </Pressable>
        )}
        {(state.status === 'DONE' || state.status === 'FAILED') && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={() => bar.dismiss()}
            style={({ pressed }) => [styles.action, { minHeight: s.touch }, pressed && styles.pressed]}>
            <Text style={[styles.actionText, { fontSize: s.font(14) }]}>닫기</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: {
    width: '100%', maxWidth: 648, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: palette.ink, borderRadius: Radius.lg,
  },
  barFailed: { backgroundColor: palette.danger },
  message: { flex: 1, color: palette.canvas },
  action: { justifyContent: 'center', paddingHorizontal: Spacing.two },
  actionText: { color: palette.primaryFill, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
