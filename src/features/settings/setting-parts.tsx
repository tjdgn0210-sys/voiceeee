import type { PropsWithChildren } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useExpenseStyles } from '../capture/use-expense-styles';

/** A small title above a panel (design `.group` + `.groupLabel`). */
export function SettingGroup({ label, children }: PropsWithChildren<{ label: string }>) {
  const styles = useExpenseStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel} accessibilityRole="header">{label}</Text>
      {children}
    </View>
  );
}

/** The coloured area that holds setting rows (design `.panel`). */
export function SettingPanel({ children }: PropsWithChildren) {
  const styles = useExpenseStyles();
  return <View style={styles.panel}>{children}</View>;
}

/** One line of a panel: title and hint on the left, a value and an arrow on the right (design `.settingRow`). */
export function SettingRow({ title, hint, value, last, danger, link, accessibilityLabel, onPress }: {
  title: string; hint?: string; value?: string; last?: boolean; danger?: boolean; link?: boolean; accessibilityLabel?: string; onPress(): void;
}) {
  const styles = useExpenseStyles();
  return (
    <Pressable
      accessibilityRole={link ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel ?? `${title}${value ? ` ${value}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, last && styles.settingRowLast, pressed && styles.pressed]}>
      <View style={styles.settingMain}>
        <Text style={[styles.settingTitle, danger && styles.settingTitleDanger]}>{title}</Text>
        {!!hint && <Text style={styles.settingHint}>{hint}</Text>}
      </View>
      {!!value && <Text style={styles.settingValue}>{value}</Text>}
      <Text accessible={false} style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** A line with a switch (design `.settingRow` + `.toggle`). */
export function SettingSwitch({ title, hint, value, last, disabled, onChange }: {
  title: string; hint?: string; value: boolean; last?: boolean; disabled?: boolean; onChange(value: boolean): void;
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
      style={[styles.settingRow, last && styles.settingRowLast, disabled && styles.disabled]}>
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

/** A line that only shows a value and cannot be pressed (design `.settingRowStatic`). The value drops below the title when there is no room. */
export function SettingInfoRow({ title, hint, value, last }: { title: string; hint?: string; value?: string; last?: boolean }) {
  const styles = useExpenseStyles();
  return (
    <View accessible accessibilityLabel={`${title}${value ? ` ${value}` : ''}`} style={[styles.settingRow, styles.settingRowStatic, last && styles.settingRowLast]}>
      <View style={[styles.settingMain, styles.settingMainStatic]}>
        <Text style={styles.settingTitle}>{title}</Text>
        {!!hint && <Text style={styles.settingHint}>{hint}</Text>}
      </View>
      {!!value && <Text style={styles.settingValue}>{value}</Text>}
    </View>
  );
}
