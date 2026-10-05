import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { palette } from '../capture/expense-styles';
import { useScaler } from './settings-context';

/**
 * A slider over a fixed list of values (the 14 font sizes). Dragging moves a thumb to the nearest step; `onChangeEnd`
 * fires when the finger lifts, so a drag does not write to storage at every step.
 * For screen readers it is an adjustable element: swipe up/down moves one step.
 */
export function StepSlider({ label, steps, value, onPreview, onChangeEnd, disabled, format }: {
  label: string; steps: readonly number[]; value: number; onPreview(value: number): void; onChangeEnd(value: number): void;
  disabled?: boolean; format(value: number): string;
}) {
  const s = useScaler();
  const [width, setWidth] = useState(0);

  const stepAt = (x: number): number => {
    if (width <= 0) return value;
    const ratio = Math.min(1, Math.max(0, x / width));
    return steps[Math.round(ratio * (steps.length - 1))];
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .enabled(!disabled)
    .onBegin(event => onPreview(stepAt(event.x)))
    .onUpdate(event => onPreview(stepAt(event.x)))
    .onEnd(event => onChangeEnd(stepAt(event.x)));

  const index = Math.max(0, steps.findIndex(step => Math.abs(step - value) < 1e-6));
  const move = (delta: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, index + delta))];
    if (next !== value) onChangeEnd(next);
  };
  const thumb = s.icon(28);
  const position = steps.length > 1 ? index / (steps.length - 1) : 0;
  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: Math.round(steps[0] * 100), max: Math.round(steps[steps.length - 1] * 100), now: Math.round(value * 100), text: format(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          accessibilityState={{ disabled: !!disabled }}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') move(1); else if (event.nativeEvent.actionName === 'decrement') move(-1); }}
          onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
          style={{ minHeight: s.touch, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
          <View pointerEvents="none" style={{ height: s.space(8), borderRadius: 4, backgroundColor: palette.line, justifyContent: 'center' }}>
            <View style={{ position: 'absolute', left: 0, width: `${position * 100}%`, height: s.space(8), borderRadius: 4, backgroundColor: palette.primary }} />
            <View
              style={{
                position: 'absolute', left: `${position * 100}%`, marginLeft: -thumb / 2, width: thumb, height: thumb, borderRadius: thumb / 2,
                backgroundColor: palette.primaryFill, borderWidth: 3, borderColor: palette.primary,
              }}
            />
          </View>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
