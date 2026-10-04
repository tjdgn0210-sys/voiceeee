import { Text, TextInput, View } from 'react-native';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';
import type { PickerFieldProps } from './picker-field';

/** Web has no native picker: the value is typed as text (the same format the form validates). */
export function PickerField({ kind, label, value, onChange, disabled, error }: PickerFieldProps) {
  const styles = useExpenseStyles();
  return (
    <View style={[styles.field, { flexGrow: 1, flexBasis: 0 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        value={value}
        maxLength={kind === 'date' ? 10 : 5}
        placeholder={kind === 'date' ? '2026-10-04' : '15:00'}
        placeholderTextColor={palette.placeholder}
        onChangeText={onChange}
        style={[styles.input, error ? { borderColor: palette.danger, borderWidth: 2 } : null]}
      />
      {!!error && <Text accessibilityRole="alert" style={styles.fieldError}>{error}</Text>}
    </View>
  );
}
