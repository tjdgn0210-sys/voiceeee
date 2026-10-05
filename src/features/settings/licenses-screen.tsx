import { Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenIntro } from '../../components/screen-intro';
import { OPEN_SOURCE_PACKAGES } from '../../constants/open-source-licenses';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { SettingInfoRow, SettingPanel } from './setting-parts';

/** The open-source packages the app is built on (direct dependencies, with their license names). */
export function LicensesScreen() {
  const styles = useExpenseStyles();
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '오픈소스 라이선스' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenIntro eyebrow="OPEN SOURCE" title="오픈소스 라이선스" description="이 앱은 아래 오픈소스를 사용해요. 각 패키지는 표시된 라이선스를 따라요." />
        <SettingPanel>
          {OPEN_SOURCE_PACKAGES.map((item, index) => (
            <SettingInfoRow
              key={item.name}
              title={item.name}
              hint={item.version}
              value={item.license}
              last={index === OPEN_SOURCE_PACKAGES.length - 1}
            />
          ))}
        </SettingPanel>
      </ScrollView>
    </SafeAreaView>
  );
}
