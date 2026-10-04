import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { APP_LINKS, isEmail, isWebUrl } from '../../constants/app-links';
import { useExpenseStyles } from '../capture/use-expense-styles';

/** Settings > information: terms, privacy policy, contact, open-source licenses and the version. A link row exists only when its address is configured. */
export function AboutSection() {
  const styles = useExpenseStyles();
  const [message, setMessage] = useState<string | null>(null);

  const open = (url: string) => {
    setMessage(null);
    Linking.openURL(url).catch(() => setMessage('열 수 없어요. 주소를 확인해 주세요'));
  };
  return (
    <View style={styles.formStack}>
      {isWebUrl(APP_LINKS.termsUrl) && (
        <Pressable accessibilityRole="link" accessibilityLabel="이용약관 열기" onPress={() => open(APP_LINKS.termsUrl)} style={styles.secondary}><Text style={styles.secondaryText}>이용약관</Text></Pressable>
      )}
      {isWebUrl(APP_LINKS.privacyUrl) && (
        <Pressable accessibilityRole="link" accessibilityLabel="개인정보 처리방침 열기" onPress={() => open(APP_LINKS.privacyUrl)} style={styles.secondary}><Text style={styles.secondaryText}>개인정보 처리방침</Text></Pressable>
      )}
      {isEmail(APP_LINKS.contactEmail) && (
        <Pressable accessibilityRole="link" accessibilityLabel="문의하기, 이메일 앱 열기" onPress={() => open(`mailto:${APP_LINKS.contactEmail}`)} style={styles.secondary}><Text style={styles.secondaryText}>문의하기</Text></Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={() => router.push('/licenses')} style={styles.secondary}><Text style={styles.secondaryText}>오픈소스 라이선스</Text></Pressable>
      {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
      <Text style={styles.muted}>앱 버전 {Constants.expoConfig?.version ?? '알 수 없음'}</Text>
    </View>
  );
}
