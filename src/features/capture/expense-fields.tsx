import { Pressable, Text, TextInput, View } from 'react-native';
import type { ExpenseForm } from './expense-form';
import { ExpenseDateFields } from './expense-date-fields';
import { palette } from './expense-styles';
import { useExpenseStyles } from './use-expense-styles';
export function ExpenseFields({ form, disabled, onChange }: { form: ExpenseForm; disabled: boolean; onChange(form: ExpenseForm): void }) {
  const styles = useExpenseStyles();
  return <View style={styles.formStack}>
    <View style={styles.field}><Text style={styles.fieldLabel}>금액 (원, 필수)</Text><TextInput accessibilityLabel="금액 (원, 필수)" editable={!disabled} value={form.amount} inputMode="numeric" maxLength={16} placeholder="예: 7000" placeholderTextColor={palette.placeholder} style={styles.input} onChangeText={amount => onChange({ ...form, amount })} /></View>
    <View style={styles.field}><Text style={styles.fieldLabel}>카테고리 (선택)</Text><TextInput accessibilityLabel="카테고리 (선택)" editable={!disabled} value={form.category} maxLength={40} placeholder="예: 식비" placeholderTextColor={palette.placeholder} style={styles.input} onChangeText={category => onChange({ ...form, category })} />
      <View style={styles.chipRow}>{['식비', '교통', '생활', '쇼핑'].map(category => <Pressable key={category} accessibilityRole="button" accessibilityState={{ selected: form.category === category, disabled }} disabled={disabled} style={[styles.chip, form.category === category && styles.chipSelected]} onPress={() => onChange({ ...form, category })}><Text style={[styles.chipText, form.category === category && styles.chipTextSelected]}>{category}</Text></Pressable>)}</View>
    </View>
    <View style={styles.field}><Text style={styles.fieldLabel}>메모 (선택)</Text><TextInput accessibilityLabel="메모 (선택)" editable={!disabled} value={form.memo} maxLength={500} multiline placeholder="어떤 지출이었나요?" placeholderTextColor={palette.placeholder} style={styles.input} onChangeText={memo => onChange({ ...form, memo })} /></View>
    <ExpenseDateFields date={form.date} time={form.time} disabled={disabled} onChange={value => onChange({ ...form, ...value })} />
  </View>;
}
