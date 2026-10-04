import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { UndoBarHost } from '@/components/undo-bar';
import { PlannerProvider } from '@/composition/planner-provider';
import { SettingsProvider } from '@/composition/settings-provider';
import { InterpretationProvider } from '@/composition/interpretation-provider';
import { ExpenseProvider } from '@/composition/expense-provider';
import { VoiceCaptureProvider } from '@/composition/voice-capture-provider';
import { DatabaseStartup } from '@/database/database-startup';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <AnimatedSplashOverlay />
      <DatabaseStartup>
        <SettingsProvider>
          <ExpenseProvider>
            <PlannerProvider>
              <InterpretationProvider>
                <VoiceCaptureProvider>
                  <Stack>
                    <Stack.Screen name="index" options={{ title: 'Voice Life Manager' }} />
                    <Stack.Screen name="ai-settings" options={{ title: 'AI 연결 설정' }} />
                    <Stack.Screen name="expense" options={{ title: '지출 상세' }} />
                    <Stack.Screen name="manual-expense" options={{ title: '지출 직접 입력' }} />
                    <Stack.Screen name="entry-form" options={{ title: '새로 적기' }} />
                    <Stack.Screen name="calendar" options={{ title: '캘린더' }} />
                    <Stack.Screen name="event" options={{ title: '일정' }} />
                    <Stack.Protected guard={false}>
                      <Stack.Screen name="explore" />
                    </Stack.Protected>
                  </Stack>
                  <UndoBarHost />
                </VoiceCaptureProvider>
              </InterpretationProvider>
            </PlannerProvider>
          </ExpenseProvider>
        </SettingsProvider>
      </DatabaseStartup>
    </ThemeProvider>
  );
}
