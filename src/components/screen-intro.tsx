import { Text, View } from 'react-native';
import { useExpenseStyles } from '../features/capture/use-expense-styles';

/** The head of a tab screen (design .intro): a small English label, a large serif title and one muted line. */
export function ScreenIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  const styles = useExpenseStyles();
  return (
    <View style={styles.intro}>
      <Text style={styles.eyebrow} accessibilityElementsHidden importantForAccessibility="no">{eyebrow}</Text>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {!!description && <Text style={styles.muted}>{description}</Text>}
    </View>
  );
}
