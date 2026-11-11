import { Component } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AlertTriangle, RotateCw } from "lucide-react-native";
import * as Updates from "expo-updates";
import { colors, radius } from "../theme";

// If a screen throws while rendering, show "Something went wrong" with a
// Reload button instead of a blank screen. Reload restarts the app's
// JavaScript (expo-updates); where that isn't available (the web preview,
// some dev setups) it just tries drawing the app again.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info?.componentStack);
  }

  reload = async () => {
    try {
      await Updates.reloadAsync();
    } catch {
      this.setState({ error: null });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <View style={styles.icon}>
            <AlertTriangle size={22} color={colors.red} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>This screen couldn't be shown. Reload to try again.</Text>
          <TouchableOpacity style={styles.button} onPress={this.reload} accessibilityRole="button">
            <RotateCw size={16} color="#fff" />
            <Text style={styles.buttonText}>Reload</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { alignSelf: "stretch", backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 22, alignItems: "center" },
  icon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.redBg, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { alignSelf: "stretch", textAlign: "center", fontSize: 16, fontWeight: "800", color: colors.text, marginBottom: 6 },
  body: { alignSelf: "stretch", textAlign: "center", fontSize: 13, color: colors.textMuted, lineHeight: 18, marginBottom: 18 },
  button: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 22 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
