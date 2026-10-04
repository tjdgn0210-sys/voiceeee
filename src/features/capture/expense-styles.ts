import { StyleSheet } from 'react-native';
import { Radius, Spacing } from '../../constants/theme';
import { DEFAULT_SCALER, type Scaler } from '../../utils/font-scale';

export const palette = {
  ink: '#172B40', muted: '#536778', primary: '#194F85', canvas: '#F5F7FA', line: '#D6DFE8', paper: '#FFFFFF', danger: '#A11D27',
  dangerSoft: '#FFF8F8', dangerBorder: '#DBA4AB', reviewFill: '#EFF5FC', reviewBorder: '#93B2D1', nowFill: '#E5EDF6',
  softBorder: '#E6ECF2', inputBorder: '#778A9C', placeholder: '#63778A', success: '#1E6B3A', successSoft: '#EEF8F1', warnSoft: '#FFF7E6', warnBorder: '#E6C27A', warn: '#7A4B00',
};

/** Shared screen styles. Font sizes follow the font scale, spacing follows half of it, and touch targets stay at 44 or more
 * (blueprint 10.2). The static `expenseStyles` below is the 100% version; screens use `useExpenseStyles()` so they follow the setting.
 */
export function createExpenseStyles(s: Scaler) {
  const space = Spacing;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.canvas },
    content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: s.space(20), gap: s.space(20), paddingBottom: s.space(40) },
    title: { fontSize: s.font(26), fontWeight: '700', color: palette.ink },
    heading: { fontSize: s.font(19), fontWeight: '700', color: palette.ink },
    text: { fontSize: s.font(16), color: palette.ink, lineHeight: s.line(16) },
    muted: { fontSize: s.font(14), color: palette.muted, lineHeight: s.font(22) },
    eyebrow: { fontSize: s.font(12), fontWeight: '700', letterSpacing: 1, color: palette.primary },
    field: { gap: s.space(8) },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: s.space(10) },
    input: { borderWidth: 1, borderColor: palette.inputBorder, borderRadius: Radius.sm, minHeight: Math.max(48, s.space(48)), paddingHorizontal: s.space(14), paddingVertical: s.space(12), color: palette.ink, fontSize: s.font(16), backgroundColor: palette.paper },
    selectionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s.space(8) },
    selectionButton: { flexGrow: 1, borderWidth: 1, borderColor: palette.inputBorder, borderRadius: Radius.sm, minHeight: Math.max(48, s.space(48)), paddingHorizontal: s.space(14), justifyContent: 'center', backgroundColor: palette.paper },
    selectionText: { color: palette.ink, fontSize: s.font(16) },
    nowButton: { minWidth: s.space(64), minHeight: Math.max(48, s.space(48)), borderRadius: Radius.sm, paddingHorizontal: s.space(12), alignItems: 'center', justifyContent: 'center', backgroundColor: palette.nowFill },
    nowText: { color: palette.primary, fontSize: s.font(16), fontWeight: '600' },
    button: { minHeight: Math.max(48, s.space(48)), backgroundColor: palette.primary, borderRadius: Radius.md, padding: s.space(14), alignItems: 'center', justifyContent: 'center' },
    voiceButton: { minHeight: Math.max(68, s.space(68)) },
    buttonText: { color: '#FFFFFF', fontSize: s.font(16), fontWeight: '700' },
    secondary: { minHeight: Math.max(48, s.space(48)), borderWidth: 1, borderColor: palette.line, borderRadius: Radius.sm, padding: s.space(12), alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper },
    secondaryText: { color: palette.primary, fontSize: s.font(16), fontWeight: '600' },
    danger: { borderColor: palette.dangerBorder, backgroundColor: palette.dangerSoft },
    dangerText: { color: palette.danger, fontSize: s.font(16), fontWeight: '600' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
    error: { color: palette.danger, fontSize: s.font(15), lineHeight: s.font(23) },
    card: { backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, borderRadius: Radius.lg, padding: s.space(20), gap: s.space(12) },
    softCard: { backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.softBorder, borderRadius: Radius.xl, padding: s.space(24), gap: s.space(12), boxShadow: '0px 4px 16px rgba(23, 43, 64, 0.06)' },
    review: { backgroundColor: palette.reviewFill, borderColor: palette.reviewBorder },
    divider: { height: 1, backgroundColor: palette.line },
    amount: { fontSize: s.font(34), fontWeight: '700', color: palette.ink, fontVariant: ['tabular-nums'] },
    record: { minHeight: Math.max(88, s.space(88)), borderBottomWidth: 1, borderBottomColor: palette.line, paddingVertical: s.space(16), gap: s.space(4) },
    recordAmount: { fontSize: s.font(21), fontWeight: '700', color: palette.ink, fontVariant: ['tabular-nums'] },

    // --- Added for the planner screens (calendar, event and task forms, settings). Spacing uses the theme tokens.
    formStack: { gap: s.space(20) },
    fieldError: { color: palette.danger, fontSize: s.font(14), lineHeight: s.font(21) },
    fieldLabel: { fontSize: s.font(15), fontWeight: '600', color: palette.ink },
    hint: { fontSize: s.font(13), color: palette.muted, lineHeight: s.font(20) },
    segment: { flexDirection: 'row', borderWidth: 1, borderColor: palette.line, borderRadius: Radius.md, backgroundColor: palette.paper, padding: s.space(space.one) },
    segmentButton: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: s.touch, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s.space(space.two), borderWidth: 2, borderColor: 'transparent' },
    segmentButtonSelected: { backgroundColor: palette.nowFill, borderColor: palette.primary },
    segmentText: { fontSize: s.font(15), color: palette.muted, fontWeight: '500', textAlign: 'center' },
    segmentTextSelected: { color: palette.primary, fontWeight: '700' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s.space(space.two) },
    chip: { minHeight: s.touch, borderRadius: Radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper, paddingHorizontal: s.space(space.three), alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
    chipSelected: { borderColor: palette.primary, borderWidth: 2, backgroundColor: palette.nowFill },
    chipText: { fontSize: s.font(15), color: palette.ink, fontWeight: '500' },
    chipTextSelected: { color: palette.primary, fontWeight: '700' },
    switchRow: { minHeight: s.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: s.space(space.three), paddingVertical: s.space(space.two) },
    switchBox: { minWidth: s.space(56), minHeight: s.touch, borderRadius: Radius.pill, borderWidth: 2, borderColor: palette.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s.space(space.two), backgroundColor: palette.paper },
    switchBoxOn: { borderColor: palette.primary, backgroundColor: palette.nowFill },
    switchText: { fontSize: s.font(14), fontWeight: '700', color: palette.muted },
    switchTextOn: { color: palette.primary },
    linkButton: { minHeight: s.touch, justifyContent: 'center', alignItems: 'center', paddingHorizontal: s.space(space.two) },
    linkText: { fontSize: s.font(15), fontWeight: '600', color: palette.primary },
    banner: { borderRadius: Radius.md, borderWidth: 1, borderColor: palette.warnBorder, backgroundColor: palette.warnSoft, padding: s.space(space.three), gap: s.space(space.one) },
    bannerText: { fontSize: s.font(14), color: palette.warn, lineHeight: s.font(21) },
    okBanner: { borderRadius: Radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.successSoft, padding: s.space(space.three), gap: s.space(space.one) },
    okBannerText: { fontSize: s.font(14), color: palette.success, lineHeight: s.font(21) },
    listRow: { minHeight: s.touch, flexDirection: 'row', alignItems: 'center', gap: s.space(space.three), paddingVertical: s.space(space.two), borderBottomWidth: 1, borderBottomColor: palette.line },
    listBody: { flex: 1, gap: s.space(space.half) },
    listTitle: { fontSize: s.font(16), fontWeight: '600', color: palette.ink },
    listMeta: { fontSize: s.font(14), color: palette.muted },
    badge: { borderRadius: Radius.pill, borderWidth: 1, borderColor: palette.line, paddingHorizontal: s.space(space.two), paddingVertical: s.space(space.half), backgroundColor: palette.paper },
    badgeText: { fontSize: s.font(12), fontWeight: '700', color: palette.muted },
    sectionTitle: { fontSize: s.font(17), fontWeight: '700', color: palette.ink },
    spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s.space(space.two) },
  });
}

export type ExpenseStyles = ReturnType<typeof createExpenseStyles>;

/** The 100% version, for code that has no access to the scale. */
export const expenseStyles = createExpenseStyles(DEFAULT_SCALER);
