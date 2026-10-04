import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useIsLoggedIn } from '../settings/use-is-logged-in';

/** P1 placeholder for guests: friends need an account (blueprint 3.3). The login sheet itself arrives in M2. */
export function PeopleScreen() {
  const styles = useExpenseStyles();
  const loggedIn = useIsLoggedIn();
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <View style={styles.content}>
        {loggedIn ? null : (
          <View style={styles.softCard}>
            <Text style={styles.heading} accessibilityRole="header">로그인이 필요해요</Text>
            <Text style={styles.text}>친구를 추가하고 일정을 주고받으려면 로그인이 필요해요.</Text>
            <Text style={styles.muted}>로그인 없이도 일정, 할 일, 지출 기록은 이 기기에서 계속 쓸 수 있어요.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
