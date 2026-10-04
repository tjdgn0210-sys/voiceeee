import { useEffect, useState, type PropsWithChildren } from 'react';
import { Button, Text, View } from 'react-native';
import type { PlannerServices } from '../application/planner/planner-services';
import { createUndoBar } from '../application/undo/undo-bar';
import { PlannerContext } from '../features/calendar/planner-context';
import { UndoBarContext } from '../hooks/use-undo-bar';
import { initializePlannerServices } from './planner-services';

export function PlannerProvider({ children }: PropsWithChildren) {
  const [undoBar] = useState(() => createUndoBar({
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }));
  const [services, setServices] = useState<PlannerServices | null>(null);
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
    return <UndoBarContext.Provider value={undoBar}><PlannerContext.Provider value={services}>{children}</PlannerContext.Provider></UndoBarContext.Provider>;
  }
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
    <Text accessibilityRole={failed ? 'alert' : 'text'} style={{ color: '#111' }}>{failed ? '일정을 준비하지 못했어요.' : '일정을 준비하고 있어요…'}</Text>
    {failed && <Button title="다시 시도" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} />}
  </View>;
}
