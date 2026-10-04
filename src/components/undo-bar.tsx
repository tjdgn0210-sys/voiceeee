import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '../features/capture/expense-styles';
import { useScaler } from '../features/settings/settings-context';
import { Radius, Spacing } from '../constants/theme';
import { useUndoBar, useUndoBarState } from '../hooks/use-undo-bar';

/** The transient "되돌리기" bar (blueprint 11.3). Mounted once at the root; it floats above the tab bar. */
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
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + s.touch + Spacing.four, paddingHorizontal: Spacing.three }]}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole={failed ? 'alert' : undefined}
        style={[styles.bar, { padding: s.space(Spacing.three), gap: s.space(Spacing.three), minHeight: s.touch }, failed && styles.barFailed]}>
        <Text style={[styles.message, { fontSize: s.font(15), lineHeight: s.line(15) }]}>{message}</Text>
        {state.status === 'SHOWN' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="되돌리기"
            onPress={() => { void bar.run(); }}
            style={({ pressed }) => [styles.action, { minHeight: s.touch }, pressed && styles.pressed]}>
            <Text style={[styles.actionText, { fontSize: s.font(15) }]}>되돌리기</Text>
          </Pressable>
        )}
        {(state.status === 'DONE' || state.status === 'FAILED') && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={() => bar.dismiss()}
            style={({ pressed }) => [styles.action, { minHeight: s.touch }, pressed && styles.pressed]}>
            <Text style={[styles.actionText, { fontSize: s.font(15) }]}>닫기</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: {
    width: '100%', maxWidth: 680, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: palette.ink, borderRadius: Radius.lg,
  },
  barFailed: { backgroundColor: palette.danger },
  message: { flex: 1, color: '#FFFFFF' },
  action: { justifyContent: 'center', paddingHorizontal: Spacing.two },
  actionText: { color: '#FFFFFF', fontWeight: '700', textDecorationLine: 'underline' },
  pressed: { opacity: 0.7 },
});
