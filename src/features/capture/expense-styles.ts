import { StyleSheet } from 'react-native';
import { Fonts, Radius } from '../../constants/theme';
import { DEFAULT_SCALER, type Scaler } from '../../utils/font-scale';

/**
 * Colours of the app, taken from design/style.css (:root). Names match the CSS variables (--ink = palette.ink);
 * `--accent` is `primary` (accent text, links, dots) and `--primaryFill` is the face of the main button and of selected cells.
 */
export const palette = {
  ink: '#221E33', muted: '#5F5A73', primary: '#6B58C4', primaryFill: '#B8A7F2', onPrimary: '#221E33',
  canvas: '#F4F1FB', paper: '#FBFAFE', line: '#E3DEF0', danger: '#B4382C', inputFill: '#F0EDF8', placeholder: '#6A6580',
  heroFill: '#B8A7F2', heroInk: '#221E33', heroMuted: '#4C4566', reviewFill: '#ECE7FA', nowFill: '#E6E0F7',
  dangerFill: '#FBEFEE', dangerLine: '#E4B9B3', overlayFill: '#F4F1FBEE',
};

const serif = { fontFamily: Fonts?.serif };

/**
 * Shared screen styles (design/style.css). Colour areas, not borders and shadows, separate things; only the thin line of a
 * secondary button, the heavier edge of a selected cell and the lines between list rows are borders.
 * Font sizes follow the font scale, spacing follows half of it and touch targets stay at 44 or more (blueprint 10.2).
 * The static `expenseStyles` below is the 100% version; screens use `useExpenseStyles()` so they follow the setting.
 */
export function createExpenseStyles(s: Scaler) {
  const tall = (px: number) => Math.max(px, s.space(px));
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.canvas },
    content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingTop: s.space(8), paddingHorizontal: s.space(24), paddingBottom: s.space(56), gap: s.space(28) },
    intro: { gap: s.space(10), paddingTop: s.space(8) },
    title: { ...serif, fontSize: s.font(38), fontWeight: '500', letterSpacing: -0.5, lineHeight: s.font(46), color: palette.ink },
    sectionTitle: { ...serif, fontSize: s.font(26), fontWeight: '500', letterSpacing: -0.3, lineHeight: s.font(34), color: palette.ink },
    heading: { ...serif, fontSize: s.font(22), fontWeight: '500', letterSpacing: -0.2, lineHeight: s.font(30), color: palette.ink },
    text: { fontSize: s.font(15), color: palette.ink, lineHeight: s.font(24) },
    muted: { fontSize: s.font(13), color: palette.muted, lineHeight: s.font(20) },
    hint: { fontSize: s.font(13), color: palette.muted, lineHeight: s.font(20) },
    eyebrow: { fontSize: s.font(11), fontWeight: '700', letterSpacing: 2, color: palette.primary },
    fieldLabel: { fontSize: s.font(12), fontWeight: '600', letterSpacing: 0.5, color: palette.muted },
    error: { color: palette.danger, fontSize: s.font(14), lineHeight: s.font(22) },
    fieldError: { color: palette.danger, fontSize: s.font(14), lineHeight: s.font(22) },
    field: { gap: s.space(8) },
    formStack: { gap: s.space(20) },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: s.space(10) },
    linkRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: s.space(24), rowGap: s.space(4) },
    spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: s.space(12) },
    divider: { height: 1, backgroundColor: palette.line },

    // Inputs: a filled area, no border (an error adds a red edge in the component).
    input: { minHeight: tall(54), paddingHorizontal: s.space(18), paddingVertical: s.space(14), borderRadius: Radius.lg, backgroundColor: palette.inputFill, color: palette.ink, fontSize: s.font(16) },
    selectionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s.space(8) },
    selectionButton: { flexGrow: 1, minHeight: tall(54), paddingHorizontal: s.space(18), justifyContent: 'center', borderRadius: Radius.lg, backgroundColor: palette.inputFill },
    selectionText: { color: palette.ink, fontSize: s.font(16) },
    nowButton: { minWidth: s.space(64), minHeight: tall(54), borderRadius: Radius.lg, paddingHorizontal: s.space(16), alignItems: 'center', justifyContent: 'center', backgroundColor: palette.nowFill },
    nowText: { color: palette.ink, fontSize: s.font(15), fontWeight: '600' },

    // Buttons: the main action is a filled pill, the others are a thin-lined pill or a text link.
    button: { minHeight: tall(54), paddingHorizontal: s.space(24), paddingVertical: s.space(14), borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primaryFill },
    voiceButton: { minHeight: tall(76) },
    buttonText: { color: palette.onPrimary, fontSize: s.font(16), fontWeight: '600', letterSpacing: 0.2, textAlign: 'center' },
    secondary: { minHeight: tall(50), paddingHorizontal: s.space(24), paddingVertical: s.space(12), borderWidth: 1, borderColor: palette.line, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
    secondaryText: { color: palette.ink, fontSize: s.font(15), fontWeight: '600', textAlign: 'center' },
    linkButton: { minHeight: s.touch, justifyContent: 'center', alignItems: 'flex-start' },
    linkText: { fontSize: s.font(14), fontWeight: '600', color: palette.primary },
    dangerLinkText: { fontSize: s.font(14), fontWeight: '600', color: palette.danger, textAlign: 'center' },
    danger: { borderColor: palette.danger, backgroundColor: 'transparent' },
    dangerButton: { backgroundColor: palette.danger },
    dangerButtonText: { color: '#FFFFFF' },
    dangerText: { color: palette.danger, fontSize: s.font(15), fontWeight: '600', textAlign: 'center' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.75 },
    smallButton: { flexGrow: 1, minHeight: s.touch, paddingHorizontal: s.space(16), borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primaryFill },
    smallButtonText: { fontSize: s.font(14), fontWeight: '600', color: palette.onPrimary, textAlign: 'center' },
    smallSecondary: { flexGrow: 1, minHeight: s.touch, paddingHorizontal: s.space(16), borderWidth: 1, borderColor: palette.line, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
    smallSecondaryText: { fontSize: s.font(14), fontWeight: '600', color: palette.ink, textAlign: 'center' },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s.space(8) },

    // Cards: colour areas without border or shadow.
    card: { gap: s.space(16), paddingTop: s.space(28), paddingHorizontal: s.space(24), paddingBottom: s.space(24), borderRadius: Radius.card, backgroundColor: palette.paper },
    softCard: { gap: s.space(16), paddingTop: s.space(28), paddingHorizontal: s.space(24), paddingBottom: s.space(24), borderRadius: Radius.card, backgroundColor: palette.paper },
    review: { gap: s.space(10), paddingTop: s.space(22), paddingHorizontal: s.space(20), paddingBottom: s.space(20), borderRadius: Radius.inner, backgroundColor: palette.reviewFill },
    requestCard: { gap: s.space(12), paddingTop: s.space(22), paddingHorizontal: s.space(20), paddingBottom: s.space(20), borderRadius: Radius.inner, backgroundColor: palette.reviewFill },
    dangerCard: { gap: s.space(12), paddingTop: s.space(22), paddingHorizontal: s.space(20), paddingBottom: s.space(20), borderRadius: Radius.inner, backgroundColor: palette.dangerFill },
    hero: { gap: s.space(6), paddingTop: s.space(32), paddingHorizontal: s.space(28), paddingBottom: s.space(28), borderRadius: Radius.card, backgroundColor: palette.heroFill },
    heroLabel: { fontSize: s.font(13), fontWeight: '600', letterSpacing: 0.4, color: palette.heroMuted },
    heroNumber: { ...serif, fontSize: s.font(60), fontWeight: '400', letterSpacing: -1.5, lineHeight: s.font(68), color: palette.heroInk, fontVariant: ['lining-nums', 'tabular-nums'] },
    heroUnit: { fontSize: s.font(22), fontWeight: '500', color: palette.heroMuted },
    heroCaption: { fontSize: s.font(13), lineHeight: s.font(20), color: palette.heroMuted, paddingTop: s.space(6) },
    notice: { flexDirection: 'row', alignItems: 'center', gap: s.space(12), paddingVertical: s.space(14), paddingHorizontal: s.space(18), borderRadius: Radius.lg, backgroundColor: palette.nowFill },
    noticeText: { flex: 1, fontSize: s.font(14), lineHeight: s.font(21), color: palette.ink },
    banner: { gap: s.space(4), paddingVertical: s.space(14), paddingHorizontal: s.space(18), borderRadius: Radius.lg, backgroundColor: palette.nowFill },
    bannerText: { fontSize: s.font(14), lineHeight: s.font(21), color: palette.ink },
    okBanner: { gap: s.space(4), paddingVertical: s.space(14), paddingHorizontal: s.space(18), borderRadius: Radius.lg, backgroundColor: palette.reviewFill },
    okBannerText: { fontSize: s.font(14), lineHeight: s.font(21), color: palette.ink },
    amount: { ...serif, fontSize: s.font(40), fontWeight: '400', letterSpacing: -0.8, color: palette.ink, fontVariant: ['lining-nums', 'tabular-nums'] },

    // Record list: no cards, only thin lines.
    record: { gap: s.space(6), minHeight: tall(88), paddingVertical: s.space(20), borderBottomWidth: 1, borderBottomColor: palette.line },
    recordTitle: { fontSize: s.font(16), fontWeight: '600', color: palette.ink },
    recordAmount: { ...serif, fontSize: s.font(23), fontWeight: '500', letterSpacing: -0.3, color: palette.ink, fontVariant: ['lining-nums', 'tabular-nums'] },
    listRow: { minHeight: tall(84), flexDirection: 'row', alignItems: 'center', gap: s.space(4), borderBottomWidth: 1, borderBottomColor: palette.line },
    listBody: { flex: 1, gap: s.space(4), minWidth: 0 },
    listTitle: { fontSize: s.font(17), fontWeight: '600', color: palette.ink },
    listMeta: { fontSize: s.font(13), color: palette.muted },
    listTime: { fontSize: s.font(13), fontWeight: '600', color: palette.primary },

    // Choosing: a pill row with a filled pill for the active one (an ink edge also marks it, so it is not colour alone).
    segment: { flexDirection: 'row', gap: s.space(4), padding: s.space(4), borderRadius: Radius.pill, backgroundColor: palette.inputFill },
    segmentButton: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: s.touch, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s.space(8), borderWidth: 2, borderColor: 'transparent' },
    segmentButtonSelected: { backgroundColor: palette.primaryFill, borderColor: palette.ink },
    segmentText: { fontSize: s.font(15), fontWeight: '600', color: palette.ink, textAlign: 'center' },
    segmentTextSelected: { color: palette.onPrimary },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s.space(8) },
    chip: { minHeight: s.touch, paddingHorizontal: s.space(18), borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', backgroundColor: palette.inputFill, borderWidth: 2, borderColor: 'transparent' },
    chipSelected: { backgroundColor: palette.primaryFill, borderColor: palette.ink },
    chipText: { fontSize: s.font(15), fontWeight: '600', color: palette.ink, textAlign: 'center' },
    chipTextSelected: { color: palette.onPrimary },

    // Setting rows and the switch.
    group: { gap: s.space(10) },
    groupLabel: { paddingLeft: s.space(8), fontSize: s.font(12), fontWeight: '700', letterSpacing: 1.5, color: palette.muted },
    panel: { paddingVertical: s.space(4), paddingHorizontal: s.space(24), borderRadius: Radius.card, backgroundColor: palette.paper },
    panelSoft: { paddingVertical: s.space(4), paddingHorizontal: s.space(18), borderRadius: Radius.inner, backgroundColor: palette.reviewFill },
    panelBlock: { gap: s.space(12), paddingTop: s.space(18), paddingBottom: s.space(20) },
    panelBlockLine: { borderTopWidth: 1, borderTopColor: palette.line },
    settingRow: { minHeight: tall(68), flexDirection: 'row', alignItems: 'center', gap: s.space(12), paddingVertical: s.space(8), borderBottomWidth: 1, borderBottomColor: palette.line },
    settingRowLast: { borderBottomWidth: 0 },
    settingMain: { flex: 1, gap: s.space(2), minWidth: 0 },
    settingTitle: { fontSize: s.font(16), fontWeight: '600', color: palette.ink },
    settingTitleDanger: { color: palette.danger },
    settingHint: { fontSize: s.font(13), lineHeight: s.font(19), color: palette.muted },
    settingValue: { fontSize: s.font(14), color: palette.muted, textAlign: 'right' },
    chevron: { fontSize: s.font(22), color: palette.muted, textAlign: 'center' },
    switchRow: { minHeight: tall(68), flexDirection: 'row', alignItems: 'center', gap: s.space(12), paddingVertical: s.space(8) },
    toggle: { width: s.space(52), height: s.space(32), padding: s.space(3), borderRadius: s.space(16), flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', backgroundColor: palette.line },
    toggleOn: { justifyContent: 'flex-end', backgroundColor: palette.primaryFill },
    toggleKnob: { width: s.space(26), height: s.space(26), borderRadius: s.space(13), backgroundColor: palette.paper },
    switchBox: { width: s.space(52), height: s.space(32), padding: s.space(3), borderRadius: s.space(16), flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', backgroundColor: palette.line },
    switchBoxOn: { justifyContent: 'flex-end', backgroundColor: palette.primaryFill },
    switchText: { fontSize: s.font(14), fontWeight: '700', color: palette.muted },
    switchTextOn: { color: palette.onPrimary },

    badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingVertical: s.space(4), paddingHorizontal: s.space(10), borderRadius: Radius.pill, backgroundColor: palette.nowFill },
    badgeText: { fontSize: s.font(12), fontWeight: '700', letterSpacing: 0.3, color: palette.ink },
    calNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    navButton: { width: Math.max(48, s.space(48)), height: Math.max(48, s.space(48)), borderRadius: s.space(24), alignItems: 'center', justifyContent: 'center' },
    navText: { fontSize: s.font(28), lineHeight: s.font(30), color: palette.ink, textAlign: 'center' },
    calLabel: { flex: 1, ...serif, fontSize: s.font(19), fontWeight: '500', letterSpacing: -0.2, color: palette.ink, textAlign: 'center' },
    meter: { flexDirection: 'row', height: s.space(8), borderRadius: 4, overflow: 'hidden', backgroundColor: palette.inputFill },
    meterFill: { height: s.space(8), backgroundColor: palette.primary },
  });
}

export type ExpenseStyles = ReturnType<typeof createExpenseStyles>;

/** The 100% version, for code that has no access to the scale. */
export const expenseStyles = createExpenseStyles(DEFAULT_SCALER);
