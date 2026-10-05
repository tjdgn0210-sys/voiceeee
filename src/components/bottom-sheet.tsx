import type { PropsWithChildren } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExpenseStyles } from '../features/capture/use-expense-styles';

/** A bottom sheet (design `.sheet`): a dimmed screen, a paper area with a serif title and a [닫기] link. */
export function BottomSheet({ visible, title, onClose, children }: PropsWithChildren<{ visible: boolean; title: string; onClose(): void }>) {
  const styles = useExpenseStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', position: 'relative' }}>
        <Pressable accessibilityElementsHidden importantForAccessibility="no" onPress={onClose} style={[styles.sheetBackdrop, { zIndex: 0 }]} />
        <View accessibilityViewIsModal style={[styles.sheet, { zIndex: 1, paddingBottom: styles.sheet.paddingBottom + insets.bottom }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.sheetClose}>
              <Text style={styles.sheetCloseText}>닫기</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}
