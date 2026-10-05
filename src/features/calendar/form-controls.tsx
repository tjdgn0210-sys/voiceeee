import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';

/** A labelled text input with its error message directly below (blueprint 11.3). */
export function FieldInput({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string; hint?: string }) {
  const styles = useExpenseStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={palette.placeholder}
        {...input}
        style={[styles.input, input.style]}
      />
      {!!hint && !error && <Text style={styles.hint}>{hint}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

/** One of several exclusive choices. The selected one has a border, bold text and the selected state (not only a colour). */
export function SegmentControl<T extends string>({ label, options, value, onChange, disabled }: {
  label: string; options: readonly { value: T; label: string }[]; value: T; onChange(value: T): void; disabled?: boolean;
}) {
  const styles = useExpenseStyles();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segment}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled: !!disabled }}
            aria-checked={selected}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[styles.segmentButton, selected && styles.segmentButtonSelected]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Multi-select pills (reminders). */
export function ChipGroup<T extends string | number>({ label, options, selected, onToggle, disabled }: {
  label: string; options: readonly { value: T; label: string }[]; selected: readonly T[]; onToggle(value: T): void; disabled?: boolean;
}) {
  const styles = useExpenseStyles();
  return (
    <View accessibilityLabel={label} style={styles.chipRow}>
      {options.map(option => {
        const isSelected = selected.includes(option.value);
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="checkbox"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: isSelected, disabled: !!disabled }}
            aria-checked={isSelected}
            disabled={disabled}
            onPress={() => onToggle(option.value)}
            style={[styles.chip, isSelected && styles.chipSelected]}>
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{isSelected ? '✓ ' : ''}{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A switch row. The knob sits on the right when on and on the left when off, and the state is exposed to screen readers. */
export function SwitchRow({ title, hint, value, onChange, disabled }: {
  title: string; hint?: string; value: boolean; onChange(value: boolean): void; disabled?: boolean;
}) {
  const styles = useExpenseStyles();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      aria-checked={value}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={styles.switchRow}>
      <View style={styles.settingMain}>
        <Text style={styles.settingTitle}>{title}</Text>
        {!!hint && <Text style={styles.settingHint}>{hint}</Text>}
      </View>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={styles.toggleKnob} />
      </View>
    </Pressable>
  );
}
