import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';

export interface PickerFieldProps {
  kind: 'date' | 'time';
  label: string;
  /** YYYY-MM-DD or HH:mm. */
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  error?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

function toPickerDate(kind: PickerFieldProps['kind'], value: string): Date {
  const parsed = kind === 'date' ? new Date(`${value}T12:00:00`) : new Date(`2000-01-01T${value}:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Date or time chosen with the system picker (native). The web build uses typed text, see picker-field.web.tsx. */
export function PickerField({ kind, label, value, onChange, disabled, error }: PickerFieldProps) {
  const styles = useExpenseStyles();
  const [open, setOpen] = useState(false);
  function change(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android' || event.type === 'dismissed') setOpen(false);
    if (event.type !== 'set' || !selected) return;
    onChange(kind === 'date'
      ? `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`
      : `${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
  }
  return (
    <View style={[styles.field, { flexGrow: 1, flexBasis: 0 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value}, 바꾸기`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.selectionButton, error ? { borderColor: palette.danger, borderWidth: 2 } : null]}>
        <Text style={styles.selectionText}>{value}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={toPickerDate(kind, value)}
          mode={kind}
          display={Platform.OS === 'ios' ? 'compact' : 'default'}
          is24Hour
          onChange={change}
          disabled={disabled}
        />
      )}
      {!!error && <Text accessibilityRole="alert" style={styles.fieldError}>{error}</Text>}
    </View>
  );
}
