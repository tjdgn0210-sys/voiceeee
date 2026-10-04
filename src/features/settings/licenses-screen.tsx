import { Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OPEN_SOURCE_PACKAGES } from '../../constants/open-source-licenses';
import { useExpenseStyles } from '../capture/use-expense-styles';

/** The open-source packages the app is built on (direct dependencies, with their license names). */
export function LicensesScreen() {
  const styles = useExpenseStyles();
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '오픈소스 라이선스' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.muted}>이 앱은 아래 오픈소스를 사용해요. 각 패키지는 표시된 라이선스를 따라요.</Text>
        <View>
          {OPEN_SOURCE_PACKAGES.map(item => (
            <View key={item.name} accessible accessibilityLabel={`${item.name} ${item.version}, ${item.license} 라이선스`} style={styles.listRow}>
              <View style={styles.listBody}>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.listMeta}>{item.version}</Text>
              </View>
              <View style={styles.badge}><Text style={styles.badgeText}>{item.license}</Text></View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
