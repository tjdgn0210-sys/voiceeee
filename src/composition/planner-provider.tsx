import { useEffect, useState, type PropsWithChildren } from 'react';
import { Button, Text, View } from 'react-native';
import { createUndoBar } from '../application/undo/undo-bar';
import { PlannerContext } from '../features/calendar/planner-context';
import { ExportContext } from '../features/settings/export-context';
import { ResetContext } from '../features/settings/reset-context';
import { UndoBarContext } from '../hooks/use-undo-bar';
import { NotificationProvider } from './notification-provider';
import { initializePlannerServices, type PlannerComposition } from './planner-services';

export function PlannerProvider({ children }: PropsWithChildren) {
  const [undoBar] = useState(() => createUndoBar({
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }));
  const [services, setServices] = useState<PlannerComposition | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    initializePlannerServices(undoBar).then(value => { if (active) setServices(value); }, () => {
      console.error('Planner service initialization failed.');
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [attempt, undoBar]);
  if (services) {
    return <UndoBarContext.Provider value={undoBar}>
      <PlannerContext.Provider value={services.planner}>
        <ExportContext.Provider value={services.exportService}>
          <ResetContext.Provider value={services.localDataReset}>
            <NotificationProvider adapter={services.notificationAdapter} reminderSync={services.reminderSync}>{children}</NotificationProvider>
          </ResetContext.Provider>
        </ExportContext.Provider>
      </PlannerContext.Provider>
    </UndoBarContext.Provider>;
  }
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
    <Text accessibilityRole={failed ? 'alert' : 'text'} style={{ color: '#111' }}>{failed ? '일정을 준비하지 못했어요.' : '일정을 준비하고 있어요…'}</Text>
    {failed && <Button title="다시 시도" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} />}
  </View>;
}
