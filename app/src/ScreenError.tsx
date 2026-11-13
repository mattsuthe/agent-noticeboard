import { Pressable, Text, View } from "react-native";
import { Link, type ErrorBoundaryProps } from "expo-router";
import { styles as s, colors } from "./theme";
export default function ScreenError({ retry }: ErrorBoundaryProps) {
  return <View style={[s.page, s.content]}>
    <Text accessibilityRole="alert" style={s.title}>This screen could not open.</Text>
    <Text style={s.text}>Your relay data is safe. Try again or open Settings to check your connection and build.</Text>
    <Pressable style={s.button} onPress={() => void retry()}><Text style={s.buttonText}>Try again</Text></Pressable>
    <Link href="/settings" style={{ color: colors.accent }}>Settings</Link>
  </View>;
}
