import { DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { UndoBarHost } from '@/components/undo-bar';
import { PlannerProvider } from '@/composition/planner-provider';
import { RootStack } from '@/composition/root-stack';
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
                  <RootStack />
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
