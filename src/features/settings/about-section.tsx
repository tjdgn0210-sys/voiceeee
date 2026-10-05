import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { APP_LINKS, isEmail, isWebUrl } from '../../constants/app-links';
import { useExpenseStyles } from '../capture/use-expense-styles';
import { SettingGroup, SettingInfoRow, SettingPanel, SettingRow } from './setting-parts';

/** Settings > information (design `#settingsPage` "정보"): terms, privacy policy, contact, open-source licenses and the version. A link row exists only when its address is configured. */
export function AboutSection() {
  const styles = useExpenseStyles();
  const [message, setMessage] = useState<string | null>(null);

  const open = (url: string) => {
    setMessage(null);
    Linking.openURL(url).catch(() => setMessage('열 수 없어요. 주소를 확인해 주세요'));
  };
  return (
    <SettingGroup label="정보">
      <SettingPanel>
        {isWebUrl(APP_LINKS.termsUrl) && (
          <SettingRow link title="이용약관" accessibilityLabel="이용약관 열기" onPress={() => open(APP_LINKS.termsUrl)} />
        )}
        {isWebUrl(APP_LINKS.privacyUrl) && (
          <SettingRow link title="개인정보 처리방침" accessibilityLabel="개인정보 처리방침 열기" onPress={() => open(APP_LINKS.privacyUrl)} />
        )}
        {isEmail(APP_LINKS.contactEmail) && (
          <SettingRow link title="문의하기" accessibilityLabel="문의하기, 이메일 앱 열기" onPress={() => open(`mailto:${APP_LINKS.contactEmail}`)} />
        )}
        <SettingRow title="오픈소스 라이선스" onPress={() => router.push('/licenses')} />
        <SettingInfoRow last title="앱 버전" value={Constants.expoConfig?.version ?? '알 수 없음'} />
      </SettingPanel>
      {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
    </SettingGroup>
  );
}
