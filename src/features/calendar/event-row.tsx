import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { EVENT_STATUS_LABELS, eventTimeLabel, type DayEvent } from '../../application/planner/calendar-model';
import { palette } from '../capture/expense-styles';
import { useExpenseStyles } from '../capture/use-expense-styles';

/** One event in a list: time, title, place and, when not simply upcoming, a written status (never colour alone). */
export function EventRow({ item }: { item: DayEvent }) {
  const styles = useExpenseStyles();
  const { event, status } = item;
  const time = eventTimeLabel(event);
  const place = event.location ? `, 장소 ${event.location}` : '';
  const statusText = status === 'UPCOMING' ? '' : `, ${EVENT_STATUS_LABELS[status]}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${time} ${event.title}${place}${statusText}, 자세히 보기`}
      onPress={() => router.push({ pathname: '/event', params: { id: event.id } })}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
      <View style={{ minWidth: 0, flexShrink: 0, maxWidth: '40%' }}>
        <Text style={[styles.listMeta, { color: palette.primary, fontWeight: '700' }]}>{time}</Text>
      </View>
      <View style={styles.listBody}>
        <Text style={[styles.listTitle, status === 'COMPLETED' || status === 'CANCELLED' ? { textDecorationLine: 'line-through' } : null]}>{event.title}</Text>
        {!!event.location && <Text style={styles.listMeta}>{event.location}</Text>}
      </View>
      {status !== 'UPCOMING' && (
        <View style={styles.badge}><Text style={styles.badgeText}>{EVENT_STATUS_LABELS[status]}</Text></View>
      )}
    </Pressable>
  );
}
