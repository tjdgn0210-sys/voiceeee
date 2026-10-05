import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenIntro } from '../../components/screen-intro';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { useIsLoggedIn } from '../settings/use-is-logged-in';

/**
 * P1 (design #peoplePage), locked state only: friends need an account (blueprint 3.3). The friend list and the login button
 * arrive with M2 and M4, so a guest sees the head and the explanation card.
 */
export function PeopleScreen() {
  const styles = useExpenseStyles();
  const loggedIn = useIsLoggedIn();
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenIntro eyebrow="FAMILY & FRIENDS" title="가족·친구" description="일정과 지출을 주고받아요. 친구마다 받는 방식을 내가 정해요." />
        {loggedIn ? null : (
          <View style={styles.requestCard}>
            <Text style={styles.heading} accessibilityRole="header">친구 기능은 로그인이 필요해요</Text>
            <Text style={styles.muted}>로그인하면 친구를 추가하고 일정과 지출을 받을 수 있어요. 로그인 없이도 일정, 할 일, 지출 기록은 이 기기에서 계속 쓸 수 있어요.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
