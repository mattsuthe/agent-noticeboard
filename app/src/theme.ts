import { DynamicColorIOS, Platform, StyleSheet } from "react-native";
const adaptive = (light: string, dark: string) => Platform.OS === "ios" ? DynamicColorIOS({ light, dark }) : light;
export const colors = {
  background: adaptive("#F2F2F7", "#000000"),
  surface: adaptive("#FFFFFF", "#1C1C1E"),
  label: adaptive("#1C1C1E", "#F2F2F7"),
  secondary: adaptive("#636366", "#AEAEB2"),
  accent: adaptive("#007AFF", "#0A84FF"),
  separator: adaptive("#E5E5EA", "#38383A"),
  danger: adaptive("#C62828", "#FF6961"),
};
export const styles = StyleSheet.create({
 page: { flex: 1, backgroundColor: colors.background },
 content: { padding: 20, gap: 16, paddingBottom: 56 },
 card: { backgroundColor: colors.surface, borderRadius: 22, padding: 20, gap: 10 },
 largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: -0.8, color: colors.label },
 title: { fontSize: 22, fontWeight: "600", letterSpacing: -0.5, color: colors.label },
 text: { fontSize: 17, lineHeight: 25, color: colors.label },
 muted: { fontSize: 13, lineHeight: 19, color: colors.secondary },
 section: { fontSize: 13, fontWeight: "500", letterSpacing: 0.7, color: colors.secondary, marginLeft: 4, marginTop: 12 },
 button: { backgroundColor: colors.accent, padding: 16, minHeight: 52, borderRadius: 16, alignItems: "center" },
 buttonText: { fontWeight: "600", fontSize: 17, color: "#FFFFFF" },
 input: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, padding: 16, color: colors.label, fontSize: 17, borderRadius: 12 },
 error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
});
