import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '../features/capture/expense-styles';
import { useScaler } from '../features/settings/settings-context';
import { Spacing } from '../constants/theme';

/**
 * Bottom tabs (blueprint 11.1): 홈 · 캘린더 · 지출 · 사람. One component for web and mobile.
 * The selected tab has a bar on top, bold text and the selected state, so it never relies on colour alone.
 * Labels may wrap; the height only grows (minHeight), never clips at large font sizes.
 */
export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const s = useScaler();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row', backgroundColor: palette.canvas, borderTopWidth: 1, borderTopColor: palette.line,
        paddingBottom: insets.bottom, paddingHorizontal: insets.left,
      }}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = typeof options.title === 'string' ? options.title : route.name;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            aria-selected={focused}
            onPress={onPress}
            style={({ pressed }) => ({
              flex: 1, minHeight: s.touch + s.space(12), alignItems: 'center', justifyContent: 'center',
              // The selected tab has a bar on top, a filled area and a bold underlined label: not colour alone.
              borderTopWidth: 3, borderTopColor: focused ? palette.ink : 'transparent',
              backgroundColor: focused ? palette.reviewFill : 'transparent',
              paddingHorizontal: s.space(Spacing.one), opacity: pressed ? 0.7 : 1,
            })}>
            <Text style={{
              fontSize: s.font(14), textAlign: 'center', color: focused ? palette.ink : palette.muted,
              fontWeight: focused ? '800' : '500', textDecorationLine: focused ? 'underline' : 'none',
            }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
